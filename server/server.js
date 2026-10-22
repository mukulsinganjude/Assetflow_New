'use strict';
/** AssetFlow REST API — Express app. */
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const store = require('./db');
const { signToken, requireAuth, requireRole } = require('./auth');
const { clean, cleanMultiline, validateAsset, isValidDate, validateConsumable } = require('./validation');

const app = express();
const isLocalDevelopmentOrigin = origin => {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return ['localhost', '127.0.0.1', '::1'].includes(host) ||
      /^10(?:\.\d{1,3}){3}$/.test(host) || /^192\.168(?:\.\d{1,3}){2}$/.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(host);
  } catch { return false; }
};
app.use(cors({
  origin(origin, callback) {
    const allowedOrigins = [
      'https://assetflow-new-1.onrender.com'
    ];

    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      isLocalDevelopmentOrigin(origin)
    ) {
      return callback(null, true);
    }

    return callback(
      new Error('This website origin is not allowed to access the AssetFlow API.')
    );
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '2mb' }));

// express.json only populates req.body for JSON requests; guarantee an object so
// handlers reading req.body.<field> don't throw a 500 on empty/non-JSON bodies.
app.use((req, res, next) => { if (req.body == null) req.body = {}; next(); });

// A route mutates the in-memory snapshot and calls persist(). Delay its JSON
// response until the local database snapshot was written.
app.use((req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = body => {
    if (!store.hasPendingWrites()) return sendJson(body);
    store.flush().then(() => sendJson(body)).catch(error => {
      console.error('Database write failed before responding:', error.message);
      if (!res.headersSent) {
        res.status(503);
        sendJson({ error: 'Could not save data. Please try again.' });
      }
    });
    return res;
  };
  next();
});

const PORT = process.env.PORT || 3000;
const presenceSessions = new Map();
const PRESENCE_TIMEOUT_MS = 75_000;
const SERVER_INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ASSET_CONDITIONS = ['Good', 'Damaged', 'Needs repair'];
const STOCK = store.STOCK_LABEL;
const isStock = value => !String(value || '').trim() || ['stock', 'unassigned'].includes(String(value).trim().toLowerCase());
const resolveAssignee = value => {
  if (isStock(value)) return STOCK;
  const sought = String(value).trim().toLowerCase();
  return (store.db.employees || []).find(employee => String(employee.name || '').trim().toLowerCase() === sought)?.name || null;
};
const unknownAssigneeError = value => `Employee "${String(value || '').trim()}" is not in Manage Employees. Add the employee there before assigning an asset.`;
const departmentForAssignee = assignedTo => {
  if (isStock(assignedTo)) return STOCK;
  const employee = (store.db.employees || []).find(row => String(row.name || '').trim().toLowerCase() === String(assignedTo).trim().toLowerCase());
  const department = String(employee?.department || '').trim();
  return store.DEPARTMENTS.includes(department) ? department : 'IT';
};
const demoteOtherPrimaryAssets = (employeeName, category, excludedIds, username, extraAssets = []) => {
  if (isStock(employeeName)) return [];
  const employee = String(employeeName).trim().toLowerCase();
  const assetCategory = String(category || '').trim().toLowerCase();
  const excluded = excludedIds || new Set();
  const assets = [...new Set([...store.db.assets, ...extraAssets])];
  const demoted = [];
  for (const asset of assets) {
    if (excluded.has(asset.id) ||
      String(asset.category || '').trim().toLowerCase() !== assetCategory ||
      String(asset.assignedTo || '').trim().toLowerCase() !== employee ||
      String(asset.assignmentType || 'Primary').trim().toLowerCase() !== 'primary') continue;
    asset.assignmentType = 'Temporary';
    store.pushHistory(asset, username, `Assignment type: Primary → Temporary (another Primary ${asset.category} assigned to ${asset.assignedTo})`);
    store.addLog(username, `Changed ${asset.name} (${asset.serial}) to Temporary because another ${asset.category} was set as Primary for ${asset.assignedTo}`);
    demoted.push(asset);
  }
  return demoted;
};
const normalizeStockHistory = entry => {
  if (!entry || typeof entry !== 'object') return entry;
  if (isStock(entry.from)) entry.from = STOCK;
  if (isStock(entry.to)) entry.to = STOCK;
  if (typeof entry.action === 'string') entry.action = entry.action.replace(/\bUnassigned\b/gi, STOCK);
  return entry;
};
const normalizeStockAsset = asset => {
  if (!asset || typeof asset !== 'object') return asset;
  asset.assignedTo = isStock(asset.assignedTo) ? STOCK : asset.assignedTo;
  asset.department = isStock(asset.department) ? STOCK : String(asset.department || '').trim();
  if ((asset.status === 'In Storage' || asset.status === 'Under Repair') && isStock(asset.assignedTo)) asset.department = STOCK;
  if (Array.isArray(asset.history)) asset.history = asset.history.map(normalizeStockHistory);
  return asset;
};
const COMPANY_EMAIL_DOMAIN = 'ccrn.com';
const normalizeCompanyEmail = value => clean(value, 254).toLowerCase();
const isCompanyEmail = value => {
  const email = normalizeCompanyEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.endsWith(`@${COMPANY_EMAIL_DOMAIN}`);
};

// Simple landing / health page so you can confirm the API is up from a browser.
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>AssetFlow API</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#1e293b;padding:2rem 2.5rem;border-radius:1rem;box-shadow:0 10px 40px rgba(0,0,0,.4);max-width:34rem}
h1{margin:0 0 .25rem;font-size:1.4rem}.ok{color:#34d399;font-weight:700}
code{background:#0f172a;padding:.15rem .4rem;border-radius:.35rem;color:#a5b4fc}
ul{line-height:1.9;padding-left:1.1rem}small{color:#94a3b8}</style></head>
<body><div class="card">
<h1>AssetFlow API <span class="ok">&#9679; running</span></h1>
<p><small>Listening on http://localhost:${PORT}</small></p>
<p>This is the backend server. Data is served under <code>/api</code>. Try:</p>
<ul>
<li><code>GET /api/health</code> &mdash; open it, no login needed</li>
<li><code>GET /api/assets</code> &mdash; returns <code>401</code> unless you send a login token</li>
<li><code>POST /api/auth/login</code> &mdash; used by the web app to sign in</li>
</ul>
<p><small>The actual app lives at <a style="color:#a5b4fc" href="http://localhost:4200">http://localhost:4200</a>.</small></p>
</div></body></html>`);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', assets: store.db.assets.length, users: store.db.users.length }));

// Never leak passHash / securityAnswer to clients.
const publicUser = (u, includeProfileImage = true) => ({
  username: u.username,
  email: u.email || '',
  role: u.role,
  displayName: u.displayName || '',
  title: u.title || '',
  ...(includeProfileImage ? { profileImage: u.profileImage || '' } : {}),
  permissions: Array.isArray(u.permissions) ? [...u.permissions] : null
});
const findUser = uname => store.db.users.find(u => u.username.toLowerCase() === String(uname).toLowerCase());
const publicComment = comment => ({
  ...comment,
  authorName: findUser(comment.user)?.displayName?.trim() || comment.authorName || comment.user
});
const publicAsset = asset => Array.isArray(asset.comments)
  ? { ...asset, comments: asset.comments.map(publicComment) }
  : asset;
const publicDellCase = row => Array.isArray(row.comments)
  ? { ...row, comments: row.comments.map(publicComment) }
  : row;
const findUserByLogin = identifier => {
  const value = clean(identifier, 254).trim();
  if (!isCompanyEmail(value)) return null;
  const email = normalizeCompanyEmail(value);
  return store.db.users.find(u => String(u.email || '').toLowerCase() === email) || null;
};

// ---------------------------------------------------------------- Auth (public)
// Brute-force login throttle (in-memory, no external deps). Locks an
// email+IP pair after too many consecutive failed attempts. State is
// per-process (resets on server restart), which is appropriate for this
// single-instance JSON-file deployment.
const LOGIN_MAX_FAILS = 5;              // consecutive failures allowed before lockout
const LOGIN_LOCK_MS = 1 * 60 * 1000;   // lock the identifier for one minute after repeated failures
const loginFails = new Map();          // key -> { count, lockedUntil, updated }
const loginKey = (req, email) => `${req.ip || 'ip'}::${String(email).toLowerCase()}`;

// Periodically prune stale entries so the Map can't grow unbounded.
const loginSweep = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginFails) {
    const idle = now - (v.updated || 0);
    if ((!v.lockedUntil || v.lockedUntil <= now) && idle > LOGIN_LOCK_MS) loginFails.delete(k);
  }
}, LOGIN_LOCK_MS);
if (loginSweep.unref) loginSweep.unref();

app.post('/api/auth/login', async (req, res) => {
  const email = normalizeCompanyEmail(req.body.email);
  const pass = String(req.body.pass || '');
  const key = loginKey(req, email);
  const now = Date.now();
  const rec = loginFails.get(key);

  // Currently locked out? Reject before touching bcrypt (also throttles CPU).
  if (rec && rec.lockedUntil && rec.lockedUntil > now) {
    const retrySec = Math.ceil((rec.lockedUntil - now) / 1000);
    res.set('Retry-After', String(retrySec));
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(retrySec / 60)} minute(s).` });
  }

  const user = findUserByLogin(email);
  if (!user || !await bcrypt.compare(pass, user.passHash)) {
    // Count consecutive failures; if a previous lock has expired, start fresh.
    let count = rec ? rec.count : 0;
    if (rec && rec.lockedUntil && rec.lockedUntil <= now) count = 0;
    count += 1;
    const next = { count, lockedUntil: 0, updated: now };
    store.addLog(email || 'unknown', `Sign-in failed (attempt ${count})`);
    if (count >= LOGIN_MAX_FAILS) {
      next.lockedUntil = now + LOGIN_LOCK_MS;
      store.addLog(email || 'unknown', `Login locked after ${count} failed attempts`);
    }
    store.persist();
    loginFails.set(key, next);
    return res.status(401).json({ error: 'Invalid company email or password.' });
  }

  // Success — clear any failure record for this key.
  loginFails.delete(key);
  store.addLog(user.username, 'User logged in');
  store.persist();
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.post('/api/auth/reset', (req, res) => res.status(410).json({
  error: 'Self-service password reset is disabled. Contact your AssetFlow administrator to reset your password.'
}));

// These endpoints are POST-only (the app sends credentials in the request body).
// Opening them in a browser makes a GET, which would otherwise fall through to
// the auth guard and show a confusing "Authentication required." — so give a
// clear, friendly hint instead.
const postOnlyHint = endpoint => (req, res) =>
  res.status(405).json({ error: `This endpoint only accepts POST requests. Please ${endpoint} through the AssetFlow app at http://localhost:4200.` });
app.get('/api/auth/login', postOnlyHint('log in'));
app.get('/api/auth/reset', postOnlyHint('reset your password'));

// Everything below requires a valid token.
app.use('/api', requireAuth);
// A token proves identity; authorization always uses the current database role.
app.use('/api', (req, res, next) => {
  const user = findUser(req.user.username);
  if (!user) return res.status(401).json({ error: 'User account no longer exists. Please log in again.' });
  req.user.role = user.role;
  req.user.displayName = user.displayName || '';
  req.user.permissions = Array.isArray(user.permissions) ? user.permissions : null;
  next();
});

// Live presence is deliberately transient: a browser session must refresh its
// heartbeat, and stale sessions disappear automatically without touching app data.
const cleanPresenceSessions = () => {
  const cutoff = Date.now() - PRESENCE_TIMEOUT_MS;
  for (const [sessionId, session] of presenceSessions) {
    if (session.lastSeen < cutoff) presenceSessions.delete(sessionId);
  }
};
app.post('/api/presence/heartbeat', (req, res) => {
  const sessionId = clean(req.body.sessionId, 64);
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(sessionId)) return res.status(400).json({ error: 'A valid browser session is required.' });
  presenceSessions.set(sessionId, { username: req.user.username, lastSeen: Date.now(), hidden: req.body.hidden === true });
  cleanPresenceSessions();
  res.json({ ok: true });
});
app.post('/api/presence/offline', (req, res) => {
  const sessionId = clean(req.body.sessionId, 64);
  const session = presenceSessions.get(sessionId);
  if (session?.username.toLowerCase() === req.user.username.toLowerCase()) presenceSessions.delete(sessionId);
  res.json({ ok: true });
});
app.get('/api/presence', (req, res) => {
  cleanPresenceSessions();
  const latestByUser = new Map();
  for (const session of presenceSessions.values()) {
    if (session.hidden) continue;
    const key = session.username.toLowerCase();
    const previous = latestByUser.get(key);
    if (!previous || session.lastSeen > previous.lastSeen) latestByUser.set(key, session);
  }
  const online = [...latestByUser.values()].map(session => {
    const user = findUser(session.username);
    return user ? {
      displayName: user.displayName || user.username,
      title: user.title || '',
      lastSeen: new Date(session.lastSeen).toISOString()
    } : null;
  }).filter(Boolean).sort((a, b) => a.displayName.localeCompare(b.displayName));
  res.json(online);
});

const PERMISSION_GROUPS = {
  dashboard: ['view'],
  assets: ['view', 'add', 'edit', 'delete', 'assign', 'import', 'export', 'comment'],
  employees: ['view', 'comment'],
  employeeDirectory: ['view', 'add', 'edit', 'delete', 'import', 'export'],
  offboarding: ['view', 'start', 'return'],
  formerEmployees: ['view', 'archive', 'export'],
  dellCases: ['view', 'add', 'edit', 'delete', 'import', 'export', 'comment'],
  warranty: ['view', 'edit', 'import', 'export'],
  links: ['view', 'add', 'delete', 'import', 'export'],
  deskSetup: ['view', 'add', 'edit', 'delete', 'import', 'export'],
  consumables: ['view', 'add', 'edit', 'delete', 'import', 'export', 'adjust'],
  dropdowns: ['view', 'manage'],
  activity: ['view', 'export', 'clear'],
  users: ['manage'],
  backup: ['manage']
};
const ALL_PERMISSIONS = Object.entries(PERMISSION_GROUPS).flatMap(([section, actions]) => actions.map(action => `${section}.${action}`));
const ROLE_PERMISSIONS = {
  admin: ALL_PERMISSIONS,
  entry: ['dashboard.view', 'assets.view', 'assets.add', 'assets.edit', 'assets.assign', 'assets.import', 'assets.export', 'assets.comment', 'employees.view', 'employees.comment', 'offboarding.view', 'offboarding.start', 'offboarding.return', 'formerEmployees.view', 'formerEmployees.archive', 'formerEmployees.export', 'dellCases.view', 'dellCases.add', 'dellCases.edit', 'dellCases.delete', 'dellCases.import', 'dellCases.export', 'dellCases.comment', 'warranty.view', 'warranty.edit', 'warranty.import', 'warranty.export', 'links.view', 'links.add', 'links.delete', 'links.import', 'links.export', 'deskSetup.view', 'deskSetup.add', 'deskSetup.edit', 'deskSetup.delete', 'deskSetup.import', 'deskSetup.export', 'activity.view', 'activity.export'],
  viewer: ['dashboard.view', 'employees.view', 'formerEmployees.view', 'formerEmployees.export', 'warranty.view', 'warranty.export', 'links.view', 'activity.view', 'activity.export']
};
function permissionForRequest(req) {
  const path = req.path.replace(/\/$/, '') || '/';
  const method = req.method;
  const pathMatch = (pattern) => pattern.test(path);
  if (path === '/assets') return method === 'GET' ? ['assets.view', 'dashboard.view', 'employees.view', 'employeeDirectory.view', 'deskSetup.view', 'dellCases.view', 'warranty.view', 'offboarding.view'] : method === 'POST' ? 'assets.add' : null;
  if (pathMatch(/^\/assets\/import$/)) return 'assets.import';
  if (pathMatch(/^\/assets\/warranty-import$/)) return 'warranty.import';
  if (pathMatch(/^\/assets\/extend-warranty$/)) return 'warranty.edit';
  if (pathMatch(/^\/assets\/process-return$/)) return 'offboarding.return';
  if (pathMatch(/^\/assets\/bulk-assign$/) || pathMatch(/^\/assets\/\d+\/assign$/)) return 'assets.assign';
  if (pathMatch(/^\/assets\/bulk-delete$/)) return 'assets.delete';
  if (pathMatch(/^\/assets\/bulk-status$/)) return 'assets.edit';
  if (pathMatch(/^\/assets\/\d+\/comments(?:\/\d+)?$/)) return method === 'GET' ? 'assets.view' : 'assets.comment';
  if (pathMatch(/^\/assets\/\d+$/)) return method === 'GET' ? 'assets.view' : method === 'PUT' ? 'assets.edit' : method === 'DELETE' ? 'assets.delete' : null;
  if (path === '/employee-comments') return 'employees.view';
  if (pathMatch(/^\/employee-comments\//)) return 'employees.comment';
  if (path === '/employees') return method === 'GET' ? ['employees.view', 'employeeDirectory.view'] : method === 'POST' ? 'employeeDirectory.add' : null;
  if (pathMatch(/^\/employees\/import$/)) return 'employeeDirectory.import';
  if (pathMatch(/^\/employees\//)) return method === 'DELETE' ? 'employeeDirectory.delete' : 'employeeDirectory.edit';
  if (path === '/offboarding-checklists') return method === 'GET' ? 'offboarding.view' : 'offboarding.start';
  if (pathMatch(/^\/offboarding-checklists\//)) return 'offboarding.return';
  if (path === '/former-employees') return 'formerEmployees.view';
  if (pathMatch(/^\/former-employees\//)) return 'formerEmployees.archive';
  if (path === '/dell-cases') return method === 'GET' ? 'dellCases.view' : method === 'POST' ? 'dellCases.add' : null;
  if (pathMatch(/^\/dell-cases\/import$/)) return 'dellCases.import';
  if (pathMatch(/^\/dell-cases\/\d+\/comments(?:\/\d+)?$/)) return 'dellCases.comment';
  if (pathMatch(/^\/dell-cases\/\d+$/)) return method === 'PUT' ? 'dellCases.edit' : method === 'DELETE' ? 'dellCases.delete' : null;
  if (path === '/consumables') return method === 'GET' ? 'consumables.view' : method === 'POST' ? 'consumables.add' : null;
  if (pathMatch(/^\/consumables\/import$/)) return 'consumables.import';
  if (pathMatch(/^\/consumables\/\d+\/adjust$/)) return 'consumables.adjust';
  if (pathMatch(/^\/consumables\/\d+$/)) return method === 'PUT' ? 'consumables.edit' : method === 'DELETE' ? 'consumables.delete' : null;
  if (path === '/desk-peripherals') return method === 'GET' ? 'deskSetup.view' : method === 'POST' ? 'deskSetup.add' : null;
  if (pathMatch(/^\/desk-peripherals\/import$/)) return 'deskSetup.import';
  if (pathMatch(/^\/desk-peripherals\/\d+$/)) return method === 'PUT' ? 'deskSetup.edit' : method === 'DELETE' ? 'deskSetup.delete' : null;
  if (path === '/links') return method === 'GET' ? 'links.view' : method === 'POST' ? 'links.add' : null;
  if (pathMatch(/^\/links\/import$/)) return 'links.import';
  if (pathMatch(/^\/links\/\d+$/)) return 'links.delete';
  if (path === '/logs') return method === 'GET' ? 'activity.view' : method === 'DELETE' ? 'activity.clear' : null;
  if (path === '/sign-in-events') return 'users.manage';
  if (path === '/dropdown-options') return method === 'GET' ? ['dropdowns.view', 'dropdowns.manage'] : method === 'PUT' ? 'dropdowns.manage' : null;
  if (path === '/users' || pathMatch(/^\/users\//)) return 'users.manage';
  if (path === '/backup' || path === '/restore') return 'backup.manage';
  return null;
}
app.use('/api', (req, res, next) => {
  const permission = permissionForRequest(req);
  if (!permission) return next();
  // Admin accounts remain the recovery/superuser path so an override cannot
  // accidentally lock administrators out of the permission management panel.
  if (req.user.role === 'admin') { req.user.permissionOverrideAllowed = true; return next(); }
  const effective = req.user.permissions == null ? (ROLE_PERMISSIONS[req.user.role] || []) : req.user.permissions;
  const allowed = (Array.isArray(permission) ? permission : [permission]).some(key => effective.includes(key));
  if (!allowed) return res.status(403).json({ error: 'This account does not have permission to perform this action.' });
  req.user.permissionOverrideAllowed = true;
  next();
});

app.get('/api/auth/profile', (req, res) => {
  const user = findUser(req.user.username);
  if (!user) return res.status(404).json({ error: 'User account not found.' });
  res.json(publicUser(user));
});

// Record session termination for the admin sign-in history panel. The browser
// still clears its local session if this best-effort audit write is unavailable.
app.post('/api/auth/logout', (req, res) => {
  store.addLog(req.user.username, 'User logged out');
  store.persist();
  res.json({ ok: true });
});

// Small revision token for clients with the app open on another device. It
// avoids polling every data table when nothing changed; the client fetches its
// current module only when the newest audited write advances.
app.get('/api/changes', (req, res) => {
  res.json({ version: `${SERVER_INSTANCE_ID}:${store.db.changeSequence || 0}` });
});

// A signed-in user may update only their profile picture. Account details,
// titles, roles, and passwords are changed by administrators in User Roles.
app.put('/api/auth/profile', (req, res) => {
  const user = findUser(req.user.username);
  if (!user) return res.status(404).json({ error: 'User account not found.' });
  if (['email', 'displayName', 'title', 'currentPassword', 'newPassword'].some(key => Object.prototype.hasOwnProperty.call(req.body, key))) {
    return res.status(403).json({ error: 'Account details and passwords can only be changed by an administrator in System Users Management.' });
  }

  let profileImage;
  if (req.body.profileImage !== undefined) {
    profileImage = req.body.profileImage == null ? '' : String(req.body.profileImage);
    if (profileImage.length > 500_000) return res.status(413).json({ error: 'Profile picture must be smaller than 350 KB.' });
    if (profileImage && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(profileImage)) {
      return res.status(400).json({ error: 'Choose a PNG, JPEG, or WebP profile picture.' });
    }
    // Note: don't mutate user.profileImage here — a later password check may
    // still reject the request. It's applied once, after all checks pass.
  }

  if (profileImage !== undefined) user.profileImage = profileImage;
  store.addLog(user.username, 'Updated profile picture');
  store.persist();
  res.json(publicUser(user));
});

// ---------------------------------------------------------------- Assets
app.get('/api/assets', (req, res) => res.json(store.db.assets.map(publicAsset)));

const canWrite = requireRole('admin', 'entry');

app.post('/api/assets', canWrite, (req, res) => {
  const v = validateAsset(req.body, { requireDates: false });
  if (!v.ok) return res.status(400).json({ error: v.error });
  const resolvedAssignee = resolveAssignee(v.value.assignedTo);
  if (!resolvedAssignee) return res.status(400).json({ error: unknownAssigneeError(v.value.assignedTo) });
  v.value.assignedTo = resolvedAssignee;
  v.value.department = departmentForAssignee(resolvedAssignee);
  if (store.db.assets.some(a => a.serial.toLowerCase() === v.value.serial.toLowerCase())) {
    return res.status(409).json({ error: `An asset with serial "${v.value.serial}" already exists.` });
  }
  if (!isStock(v.value.assignedTo)) {
    const sameCategory = store.db.assets.filter(a =>
      String(a.category || '').trim().toLowerCase() === v.value.category.toLowerCase() &&
      !isStock(a.assignedTo)
    );
    const sameEmployee = sameCategory.filter(a => String(a.assignedTo).trim().toLowerCase() === v.value.assignedTo.toLowerCase());
    const sameModelForEmployee = sameEmployee.filter(a => String(a.name || '').trim().toLowerCase() === v.value.name.toLowerCase());
    const sameModelForOthers = sameCategory.filter(a =>
      String(a.name || '').trim().toLowerCase() === v.value.name.toLowerCase() &&
      String(a.assignedTo).trim().toLowerCase() !== v.value.assignedTo.toLowerCase()
    );
    const hasCategoryOverlap = sameEmployee.length > 0;
    const hasModelOverlap = sameModelForOthers.length > 0;
    if ((hasCategoryOverlap || hasModelOverlap) && req.body.allowDuplicateAssignment !== true) {
      const details = [];
      if (sameModelForEmployee.length) details.push(`${v.value.assignedTo} already has this ${v.value.category} model (${sameModelForEmployee.map(a => `${a.name}, ${a.serial}`).join('; ')}).`);
      else if (sameEmployee.length) details.push(`${v.value.assignedTo} already has ${v.value.category} equipment (${sameEmployee.map(a => `${a.name}, ${a.serial}`).join('; ')}).`);
      if (sameModelForOthers.length) details.push(`This model is assigned to ${[...new Set(sameModelForOthers.map(a => `${a.assignedTo} (${a.serial})`))].join(', ')}.`);
      return res.status(409).json({ code: 'ASSET_ASSIGNMENT_CONFIRMATION_REQUIRED', error: `${details.join(' ')} Confirm that this is an intentional additional unit.` });
    }
  }
  const asset = { id: store.nextId(), ...v.value };
  if (asset.assignmentType === 'Primary') demoteOtherPrimaryAssets(asset.assignedTo, asset.category, new Set(), req.user.username);
  store.pushHistory(asset, req.user.username, `Registered · ${asset.status} · assigned to ${asset.assignedTo || STOCK}`);
  // Optional initial note captured on the entry form (validateAsset strips it,
  // so read it straight off the raw body). Seeds the asset's comment thread.
  const initialComment = cleanMultiline(req.body.comment, 500);
  if (initialComment) {
    asset.comments = [{ id: 1, ts: new Date().toISOString(), user: req.user.username, text: initialComment }];
    store.pushHistory(asset, req.user.username, `Comment added: ${initialComment}`);
    store.addLog(req.user.username, `Commented on ${asset.name} (${asset.serial})`);
  }
  store.db.assets.unshift(asset);
  store.upsertEmployee(asset.assignedTo, asset.department);
  store.addLog(req.user.username, `Registered item: ${asset.name} (${asset.serial})`);
  store.persist();
  res.status(201).json(asset);
});

app.put('/api/assets/:id', canWrite, (req, res) => {
  const id = Number(req.params.id);
  const idx = store.db.assets.findIndex(a => a.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Asset not found.' });
  const v = validateAsset(req.body, { requireDates: false });
  if (!v.ok) return res.status(400).json({ error: v.error });
  const resolvedAssignee = resolveAssignee(v.value.assignedTo);
  if (!resolvedAssignee) return res.status(400).json({ error: unknownAssigneeError(v.value.assignedTo) });
  v.value.assignedTo = resolvedAssignee;
  v.value.department = departmentForAssignee(resolvedAssignee);
  if (store.db.assets.some(a => a.id !== id && a.serial.toLowerCase() === v.value.serial.toLowerCase())) {
    return res.status(409).json({ error: `Another asset already uses serial "${v.value.serial}".` });
  }
  const prev = store.db.assets[idx];
  // validateAsset() strips the history/comments arrays, and this assignment
  // replaces the whole object — so carry the existing timeline + comments forward.
  const updated = {
    id, ...v.value,
    history: Array.isArray(prev.history) ? prev.history : [],
    comments: Array.isArray(prev.comments) ? prev.comments : []
  };
  if (updated.assignmentType === 'Primary') demoteOtherPrimaryAssets(updated.assignedTo, updated.category, new Set([id]), req.user.username);
  const fields = [
    ['name', 'Name'], ['category', 'Category'], ['department', 'Department'],
    ['serial', 'Serial'], ['assignmentType', 'Assignment type'], ['assignedTo', 'Assigned to'], ['status', 'Status'],
    ['purchaseDate', 'Purchase date'], ['warrantyDate', 'Warranty date']
  ];
  store.db.assets[idx] = updated;
  let changed = 0;
  fields.forEach(([key, label]) => {
    const before = prev[key] || '—';
    const after = updated[key] || '—';
    if (before !== after) { store.pushHistory(updated, req.user.username, `${label}: ${before} → ${after}`); changed++; }
  });
  if (!changed) store.pushHistory(updated, req.user.username, 'Edited (no field values changed)');
  store.upsertEmployee(updated.assignedTo, updated.department);
  store.addLog(req.user.username, `Updated item: ${v.value.name} (${v.value.serial})`);
  store.persist();
  res.json(store.db.assets[idx]);
});

app.delete('/api/assets/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const index = store.db.assets.findIndex(a => a.id === id);
  if (index < 0) return res.status(404).json({ error: 'Asset not found.' });
  const [record] = store.db.assets.splice(index, 1);
  if (!Array.isArray(store.db.deletedRecords)) store.db.deletedRecords = [];
  store.db.deletedRecords.unshift({ id: store.nextId(), type: 'asset', record, deletedAt: new Date().toISOString(), deletedBy: req.user.displayName || req.user.username });
  store.addLog(req.user.username, `Moved asset ${record.name} (${record.serial}) to the recovery archive`);
  store.persist();
  res.json({ ok: true });
});

app.get('/api/recovery-archive', requireRole('admin'), (req, res) => res.json(store.db.deletedRecords || []));
app.post('/api/recovery-archive/:id/restore', requireRole('admin'), (req, res) => {
  const index = (store.db.deletedRecords || []).findIndex(row => Number(row.id) === Number(req.params.id));
  if (index < 0) return res.status(404).json({ error: 'Archived record not found.' });
  const archived = store.db.deletedRecords[index];
  if (archived.type === 'asset') {
    const record = archived.record;
    if ((store.db.assets || []).some(asset => String(asset.serial || '').trim().toLowerCase() === String(record.serial || '').trim().toLowerCase())) {
      return res.status(409).json({ error: `Cannot restore: serial ${record.serial} is already in active inventory.` });
    }
    store.db.assets.push(record);
  } else if (archived.type === 'employee') {
    const record = archived.record;
    if ((store.db.employees || []).some(employee => employee.name.toLowerCase() === record.name.toLowerCase())) return res.status(409).json({ error: `Cannot restore: employee ${record.name} already exists.` });
    store.db.employees.push(record);
  } else if (archived.type === 'consumable') {
    const record = archived.record;
    if ((store.db.consumables || []).some(row => row.name.toLowerCase() === record.name.toLowerCase() && String(row.location || '').toLowerCase() === String(record.location || '').toLowerCase())) return res.status(409).json({ error: `Cannot restore: ${record.name} already exists at that location.` });
    store.db.consumables.unshift(record);
  } else if (archived.type === 'deskPeripheral') {
    const record = archived.record;
    if ((store.db.deskPeripherals || []).some(row => String(row.serial || '').toLowerCase() === String(record.serial || '').toLowerCase())) return res.status(409).json({ error: `Cannot restore: serial ${record.serial} is already used by another desk item.` });
    store.db.deskPeripherals.unshift(record);
  } else if (archived.type === 'dellCase') {
    const record = archived.record;
    if ((store.db.dellCases || []).some(row => row.caseId.toLowerCase() === record.caseId.toLowerCase())) return res.status(409).json({ error: `Cannot restore: Dell case ${record.caseId} already exists.` });
    store.db.dellCases.unshift(record);
  } else if (archived.type === 'quickLink') {
    const record = archived.record;
    if ((store.db.quickLinks || []).some(row => row.name.toLowerCase() === record.name.toLowerCase() && row.url === record.url)) return res.status(409).json({ error: `Cannot restore: ${record.name} is already in shared links.` });
    store.db.quickLinks.unshift(record);
  } else return res.status(400).json({ error: 'This archived record type cannot be restored.' });
  store.db.deletedRecords.splice(index, 1);
  store.addLog(req.user.username, `Restored ${archived.type} ${archived.type === 'asset' ? `${archived.record.name} (${archived.record.serial})` : archived.record.name} from recovery archive`);
  store.persist();
  res.json({ ok: true, restoredBy: req.user.displayName || req.user.username });
});

// Check-in / check-out: reassign a single asset to a person or back to storage,
// with an optional reason. Records a descriptive lifecycle entry (who → who, why)
// so the history timeline tells the full custody story.
app.post('/api/assets/:id/assign', canWrite, (req, res) => {
  const id = Number(req.params.id);
  const asset = store.db.assets.find(a => a.id === id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });
  const rawAssignedTo = clean(req.body.assignedTo, 80);
  const assignedTo = resolveAssignee(rawAssignedTo);
  if (!assignedTo) return res.status(400).json({ error: unknownAssigneeError(rawAssignedTo) });
  const assignmentType = clean(req.body.assignmentType || asset.assignmentType || 'Primary', 20);
  if (!['Primary', 'Temporary'].includes(assignmentType)) return res.status(400).json({ error: 'Invalid assignment type.' });
  const reason = clean(req.body.reason, 200);
  if (req.body.condition !== undefined && !ASSET_CONDITIONS.includes(req.body.condition)) return res.status(400).json({ error: 'Choose a valid asset condition.' });
  const condition = req.body.condition;
  const accessoryKeys = ['charger', 'mouse', 'dockingStation', 'bag', 'adapter'];
  if (req.body.handoverChecklist !== undefined) {
    const checklist = req.body.handoverChecklist;
    if (asset.category !== 'Laptop' || !checklist || typeof checklist !== 'object' || Array.isArray(checklist) ||
      Object.keys(checklist).some(key => !accessoryKeys.includes(key) || typeof checklist[key] !== 'boolean')) {
      return res.status(400).json({ error: 'Invalid laptop accessory checklist.' });
    }
  }
  let status = asset.status;
  if (req.body.status !== undefined && req.body.status !== '') {
    status = clean(req.body.status, 40);
    if (!store.STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  }
  if ((status === 'In Use' && isStock(assignedTo)) || (status === 'In Storage' && !isStock(assignedTo))) {
    return res.status(400).json({ error: `Status ${status} does not match the selected assignee. Choose an employee for In Use or Stock for In Storage.` });
  }
  const prevAssignee = asset.assignedTo || STOCK;
  const prevStatus = asset.status;
  const prevDepartment = asset.department;
  const department = departmentForAssignee(assignedTo);
  const prevAssignmentType = asset.assignmentType || 'Primary';
  if (assignedTo === prevAssignee && status === prevStatus && department === prevDepartment && assignmentType === prevAssignmentType) {
    return res.status(400).json({ error: 'No change — the asset already has that assignee and status.' });
  }
  const isCheckIn = isStock(assignedTo);
  if (assignmentType === 'Primary') demoteOtherPrimaryAssets(assignedTo, asset.category, new Set([id]), req.user.username);
  asset.assignedTo = assignedTo;
  asset.status = status;
  asset.department = department;
  asset.assignmentType = assignmentType;
  let action = `${isCheckIn ? 'Checked in' : 'Checked out'} · ${prevAssignee} → ${assignedTo}`;
  if (status !== prevStatus) action += ` · status ${prevStatus} → ${status}`;
  if (department !== prevDepartment) action += ` · department ${prevDepartment || '—'} → ${department}`;
  if (assignmentType !== prevAssignmentType) action += ` · type ${prevAssignmentType} → ${assignmentType}`;
  if (condition) action += ` · condition at ${isCheckIn ? 'return' : 'handover'}: ${condition}`;
  if (reason) action += ` · reason: ${reason}`;
  const handoverChecklist = asset.category === 'Laptop' && req.body.handoverChecklist && typeof req.body.handoverChecklist === 'object'
    ? { stage: isCheckIn ? 'returned' : 'issued', accessories: Object.fromEntries(accessoryKeys.map(key => [key, req.body.handoverChecklist[key] === true])) }
    : undefined;
  if (handoverChecklist) action += ` · ${handoverChecklist.stage === 'issued' ? 'handover' : 'return'} accessories confirmed: ${accessoryKeys.filter(key => handoverChecklist.accessories[key]).join(', ') || 'none'}`;
  store.pushHistory(asset, req.user.username, action, { from: prevAssignee, to: assignedTo, ...(condition ? { condition } : {}), ...(handoverChecklist ? { handoverChecklist } : {}) });
  store.upsertEmployee(assignedTo, asset.department);
  store.addLog(req.user.username, `${isCheckIn ? 'Checked in' : 'Checked out'} ${asset.name} (${asset.serial}) — ${isCheckIn ? 'to storage' : 'to ' + assignedTo}`);
  store.persist();
  res.json(asset);
});

// ---------------------------------------------------------------- Asset comments
// Comments live on the asset (asset.comments, newest-first) and travel with
// GET /api/assets, so no separate collection/endpoint is needed to read them.
app.post('/api/assets/:id/comments', canWrite, (req, res) => {
  const id = Number(req.params.id);
  const asset = store.db.assets.find(a => a.id === id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });
  const text = cleanMultiline(req.body.text, 500);
  if (!text) return res.status(400).json({ error: 'Comment text is required.' });
  if (!Array.isArray(asset.comments)) asset.comments = [];
  const nextId = asset.comments.length ? Math.max(...asset.comments.map(c => c.id || 0)) + 1 : 1;
  const comment = { id: nextId, ts: new Date().toISOString(), user: req.user.username, text };
  asset.comments.unshift(comment);
  store.pushHistory(asset, req.user.username, `Comment added: ${text}`);
  store.addLog(req.user.username, `Commented on ${asset.name} (${asset.serial})`);
  store.persist();
  res.status(201).json(publicComment(comment));
});

app.delete('/api/assets/:id/comments/:commentId', canWrite, (req, res) => {
  const id = Number(req.params.id);
  const commentId = Number(req.params.commentId);
  const asset = store.db.assets.find(a => a.id === id);
  if (!asset || !Array.isArray(asset.comments)) return res.status(404).json({ error: 'Asset or comment not found.' });
  const cIdx = asset.comments.findIndex(c => c.id === commentId);
  if (cIdx === -1) return res.status(404).json({ error: 'Comment not found.' });
  // Only an admin or the original author may delete a comment.
  if (req.user.role !== 'admin' && asset.comments[cIdx].user !== req.user.username) {
    return res.status(403).json({ error: 'You can only delete your own comments.' });
  }
  asset.comments.splice(cIdx, 1);
  store.pushHistory(asset, req.user.username, 'Comment deleted.');
  store.addLog(req.user.username, `Deleted a comment on ${asset.name} (${asset.serial})`);
  store.persist();
  res.json({ ok: true });
});

app.put('/api/assets/:id/comments/:commentId', canWrite, (req, res) => {
  const id = Number(req.params.id);
  const commentId = Number(req.params.commentId);
  const asset = store.db.assets.find(a => a.id === id);
  if (!asset || !Array.isArray(asset.comments)) return res.status(404).json({ error: 'Asset or comment not found.' });
  const c = asset.comments.find(x => x.id === commentId);
  if (!c) return res.status(404).json({ error: 'Comment not found.' });
  // Only an admin or the original author may edit a comment.
  if (req.user.role !== 'admin' && c.user !== req.user.username) {
    return res.status(403).json({ error: 'You can only edit your own comments.' });
  }
  const text = cleanMultiline(req.body.text, 500);
  if (!text) return res.status(400).json({ error: 'Comment text is required.' });
  c.text = text;
  c.editedTs = new Date().toISOString();
  store.pushHistory(asset, req.user.username, `Comment edited: ${text}`);
  store.addLog(req.user.username, `Edited a comment on ${asset.name} (${asset.serial})`);
  store.persist();
  res.json(c);
});

// ---------------------------------------------------------------- Employee comments
// Employees are derived from asset.assignedTo (there is no employee table), so
// their comments live in a separate name-keyed map (store.db.employeeComments)
// rather than on any single asset. Keyed by the exact employee name.
// Express has already decoded route parameters; decoding again corrupts names
// containing percent-encoded characters (and throws for a literal "%").
const empKey = raw => clean(String(raw || ''), 80);

app.get('/api/employee-comments', (req, res) => {
  const comments = store.db.employeeComments || {};
  res.json(Object.fromEntries(Object.entries(comments).map(([name, rows]) => [name, Array.isArray(rows) ? rows.map(publicComment) : rows])));
});

app.post('/api/employee-comments/:name', canWrite, (req, res) => {
  const name = empKey(req.params.name);
  if (!name) return res.status(400).json({ error: 'Employee name is required.' });
  const text = cleanMultiline(req.body.text, 500);
  if (!text) return res.status(400).json({ error: 'Comment text is required.' });
  if (!store.db.employeeComments || typeof store.db.employeeComments !== 'object') store.db.employeeComments = {};
  const list = Array.isArray(store.db.employeeComments[name]) ? store.db.employeeComments[name] : [];
  const nextId = list.length ? Math.max(...list.map(c => c.id || 0)) + 1 : 1;
  const comment = { id: nextId, ts: new Date().toISOString(), user: req.user.username, text };
  list.unshift(comment);
  store.db.employeeComments[name] = list;
  store.addLog(req.user.username, `Commented on employee ${name}`);
  store.persist();
  res.status(201).json(publicComment(comment));
});

app.put('/api/employee-comments/:name/:commentId', canWrite, (req, res) => {
  const name = empKey(req.params.name);
  const commentId = Number(req.params.commentId);
  const list = store.db.employeeComments && store.db.employeeComments[name];
  if (!Array.isArray(list)) return res.status(404).json({ error: 'Employee or comment not found.' });
  const c = list.find(x => x.id === commentId);
  if (!c) return res.status(404).json({ error: 'Comment not found.' });
  if (req.user.role !== 'admin' && c.user !== req.user.username) {
    return res.status(403).json({ error: 'You can only edit your own comments.' });
  }
  const text = cleanMultiline(req.body.text, 500);
  if (!text) return res.status(400).json({ error: 'Comment text is required.' });
  c.text = text;
  c.editedTs = new Date().toISOString();
  store.addLog(req.user.username, `Edited a comment on employee ${name}`);
  store.persist();
  res.json(c);
});

app.delete('/api/employee-comments/:name/:commentId', canWrite, (req, res) => {
  const name = empKey(req.params.name);
  const commentId = Number(req.params.commentId);
  const list = store.db.employeeComments && store.db.employeeComments[name];
  if (!Array.isArray(list)) return res.status(404).json({ error: 'Employee or comment not found.' });
  const idx = list.findIndex(x => x.id === commentId);
  if (idx === -1) return res.status(404).json({ error: 'Comment not found.' });
  if (req.user.role !== 'admin' && list[idx].user !== req.user.username) {
    return res.status(403).json({ error: 'You can only delete your own comments.' });
  }
  list.splice(idx, 1);
  if (list.length === 0) delete store.db.employeeComments[name];
  store.addLog(req.user.username, `Deleted a comment on employee ${name}`);
  store.persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Employee roster
// A first-class table of people assets can be assigned to. It is kept in sync
// automatically whenever an asset is assigned (see store.upsertEmployee), and can
// also be managed directly here. Names are unique case-insensitively.
app.get('/api/employees', (req, res) => {
  const list = (store.db.employees || [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(list);
});

app.post('/api/employees', requireRole('admin'), (req, res) => {
  const name = clean(req.body.name, 80);
  if (!name) return res.status(400).json({ error: 'Employee name is required.' });
  if (isStock(name)) return res.status(400).json({ error: '"Stock" is a reserved name.' });
  const department = clean(req.body.department, 40);
  if (department && !store.DEPARTMENTS.includes(department)) return res.status(400).json({ error: 'Invalid department.' });
  const cciInput = String(req.body.cciId || '').trim().replace(/^CCI/i, '');
  if (cciInput && !/^\d{1,20}$/.test(cciInput)) return res.status(400).json({ error: 'CCIID must contain digits only (for example, 1043).' });
  if (cciInput && store.db.employees.some(e => String(e.cciId || '') === cciInput)) return res.status(409).json({ error: `CCIID CCI${cciInput} is already assigned to another employee.` });
  if ((store.db.employees || []).some(e => e.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: `An employee named "${name}" already exists.` });
  }
  store.upsertEmployee(name, department);
  const createdEmployee = store.db.employees.find(e => e.name.toLowerCase() === name.toLowerCase());
  if (createdEmployee && cciInput) createdEmployee.cciId = cciInput;
  store.addLog(req.user.username, `Added employee: ${name}`);
  store.persist();
  const created = store.db.employees.find(e => e.name.toLowerCase() === name.toLowerCase());
  res.status(201).json(created);
});

app.post('/api/employees/import', requireRole('admin'), (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const errors = []; let imported = 0;
  for (const [index, row] of rows.entries()) {
    const pick = (...keys) => keys.map(key => row?.[key]).find(value => value !== undefined && value !== null);
    const name = clean(pick('Employee', 'Employee Name', 'Name', 'name'), 80);
    const department = clean(pick('Department', 'department'), 40);
    const cciId = String(pick('CCIID', 'CCI ID', 'cciId') || '').trim().replace(/^CCI/i, '');
    let error = !name ? 'Employee name is required.' : isStock(name) ? 'Stock is reserved.' :
      department && !store.DEPARTMENTS.includes(department) ? 'Invalid department.' :
      cciId && !/^\d{1,20}$/.test(cciId) ? 'CCIID must contain digits only.' : '';
    if (!error && store.db.employees.some(employee => employee.name.toLowerCase() === name.toLowerCase())) error = `Employee "${name}" already exists.`;
    if (!error && cciId && store.db.employees.some(employee => String(employee.cciId || '') === cciId)) error = `CCIID CCI${cciId} is already assigned.`;
    if (error) { errors.push(`Row ${index + 2}: ${error}`); continue; }
    store.upsertEmployee(name, department);
    const employee = store.db.employees.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (employee && cciId) employee.cciId = cciId;
    imported++;
  }
  if (imported) { store.addLog(req.user.username, `Imported ${imported} employee(s)`); store.persist(); }
  res.json({ imported, skipped: errors.length, errors });
});

app.put('/api/employees/:name', requireRole('admin'), (req, res) => {
  const current = empKey(req.params.name);
  const emp = (store.db.employees || []).find(e => e.name.toLowerCase() === current.toLowerCase());
  if (!emp) return res.status(404).json({ error: 'Employee not found.' });
  const newName = clean(req.body.name, 80) || emp.name;
  if (isStock(newName)) return res.status(400).json({ error: '"Stock" is a reserved name.' });
  if (newName.toLowerCase() !== emp.name.toLowerCase()
    && store.db.employees.some(e => e.name.toLowerCase() === newName.toLowerCase())) {
    return res.status(409).json({ error: `An employee named "${newName}" already exists.` });
  }
  const department = req.body.department !== undefined ? clean(req.body.department, 40) : emp.department;
  if (department && !store.DEPARTMENTS.includes(department)) return res.status(400).json({ error: 'Invalid department.' });
  if (req.body.cciId !== undefined) {
    const cciInput = String(req.body.cciId || '').trim().replace(/^CCI/i, '');
    if (cciInput && !/^\d{1,20}$/.test(cciInput)) return res.status(400).json({ error: 'CCIID must contain digits only (for example, 1043).' });
    if (cciInput && store.db.employees.some(e => e !== emp && String(e.cciId || '') === cciInput)) return res.status(409).json({ error: `CCIID CCI${cciInput} is already assigned to another employee.` });
    if (cciInput) emp.cciId = cciInput;
    else delete emp.cciId;
  }
  const prevName = emp.name;
  const prevDepartment = emp.department;
  emp.name = newName;
  emp.department = department;
  // Renaming cascades to every asset held by that person so assignments stay linked.
  if (prevName !== newName) {
    store.db.assets.forEach(a => {
      if ((a.assignedTo || '').toLowerCase() !== prevName.toLowerCase()) return;
      a.assignedTo = newName;
      store.pushHistory(a, req.user.username, `Assigned employee renamed: ${prevName} → ${newName}`);
    });
    const comments = store.db.employeeComments || {};
    const commentKey = Object.keys(comments).find(key => key.toLowerCase() === prevName.toLowerCase());
    if (commentKey && commentKey !== newName) {
      comments[newName] = [...(Array.isArray(comments[newName]) ? comments[newName] : []), ...(Array.isArray(comments[commentKey]) ? comments[commentKey] : [])];
      delete comments[commentKey];
    }
  }
  if (department && department !== prevDepartment) {
    store.db.assets.forEach(a => {
      if ((a.assignedTo || '').toLowerCase() !== newName.toLowerCase() || a.department === department) return;
      const assetDepartment = a.department || '—';
      a.department = department;
      store.pushHistory(a, req.user.username, `Department: ${assetDepartment} → ${department}`);
    });
  }
  store.addLog(req.user.username, prevName === newName ? `Updated employee: ${newName}` : `Renamed employee: ${prevName} → ${newName}`);
  store.persist();
  res.json(emp);
});

app.delete('/api/employees/:name', requireRole('admin'), (req, res) => {
  const name = empKey(req.params.name);
  const idx = (store.db.employees || []).findIndex(e => e.name.toLowerCase() === name.toLowerCase());
  if (idx === -1) return res.status(404).json({ error: 'Employee not found.' });
  const held = store.db.assets.filter(a => String(a.assignedTo || '').trim().toLowerCase() === store.db.employees[idx].name.trim().toLowerCase()).length;
  if (held > 0) return res.status(409).json({ error: `Cannot remove — ${held} asset(s) are still assigned to this employee.` });
  const [removed] = store.db.employees.splice(idx, 1);
  if (!Array.isArray(store.db.deletedRecords)) store.db.deletedRecords = [];
  store.db.deletedRecords.unshift({ id: store.nextId(), type: 'employee', record: removed, deletedAt: new Date().toISOString(), deletedBy: req.user.displayName || req.user.username });
  store.addLog(req.user.username, `Moved employee ${removed.name} to the recovery archive`);
  store.persist();
  res.json({ ok: true });
});

// Coerce a request's `ids` into a bounded list of positive integer ids. Rejects
// NaN/Infinity/floats and caps length so a huge array can't tie up the server.
const asNumIds = body => Array.isArray(body.ids)
  ? body.ids.map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 10000)
  : [];

app.post('/api/assets/bulk-status', canWrite, (req, res) => {
  const ids = new Set(asNumIds(req.body));
  const status = clean(req.body.status, 40);
  if (!store.STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const targets = store.db.assets.filter(asset => ids.has(asset.id));
  const incompatible = targets.filter(asset =>
    (status === 'In Use' && isStock(asset.assignedTo)) ||
    (status === 'In Storage' && !isStock(asset.assignedTo))
  );
  if (incompatible.length) {
    const direction = status === 'In Use' ? 'assigned to an employee' : 'in Stock';
    return res.status(409).json({ error: `Cannot set ${status} for ${incompatible.length} selected asset(s) that are not ${direction}. Change their assignments first, or select compatible assets.` });
  }
  let count = 0;
  store.db.assets.forEach(a => {
    if (ids.has(a.id)) {
      const prevDepartment = a.department;
      if (a.status !== status) store.pushHistory(a, req.user.username, `Status: ${a.status} → ${status} (bulk update)`);
      a.status = status;
      a.department = departmentForAssignee(a.assignedTo);
      if (a.department !== prevDepartment) store.pushHistory(a, req.user.username, `Department: ${prevDepartment || '—'} → ${a.department}`);
      count++;
    }
  });
  store.addLog(req.user.username, `Bulk updated status to '${status}' for ${count} items`);
  store.persist();
  res.json({ ok: true, count });
});

// Bulk assign: reassign many selected assets to one employee (or back to storage)
// in a single call, optionally also setting a status. Records a per-asset history
// entry so each item's timeline stays accurate.
app.post('/api/assets/bulk-assign', canWrite, (req, res) => {
  const ids = new Set(asNumIds(req.body));
  const rawAssignedTo = clean(req.body.assignedTo, 80);
  const assignedTo = resolveAssignee(rawAssignedTo);
  if (!assignedTo) return res.status(400).json({ error: unknownAssigneeError(rawAssignedTo) });
  const assignmentType = clean(req.body.assignmentType || 'Primary', 20);
  if (!['Primary', 'Temporary'].includes(assignmentType)) return res.status(400).json({ error: 'Invalid assignment type.' });
  const reason = clean(req.body.reason, 200);
  let status = '';
  if (req.body.status !== undefined && req.body.status !== '') {
    status = clean(req.body.status, 40);
    if (!store.STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  }
  if (status && ((status === 'In Use' && isStock(assignedTo)) || (status === 'In Storage' && !isStock(assignedTo)))) {
    return res.status(400).json({ error: `Status ${status} does not match the selected assignee. Choose an employee for In Use or Stock for In Storage.` });
  }
  const selectedByCategory = new Map();
  if (assignmentType === 'Primary' && !isStock(assignedTo)) {
    store.db.assets.filter(a => ids.has(a.id)).forEach(asset => {
      const categoryKey = String(asset.category || '').trim().toLowerCase();
      if (!selectedByCategory.has(categoryKey)) selectedByCategory.set(categoryKey, asset.id);
    });
    for (const [categoryKey] of selectedByCategory) {
      const category = store.db.assets.find(asset => ids.has(asset.id) && String(asset.category || '').trim().toLowerCase() === categoryKey)?.category;
      if (category) demoteOtherPrimaryAssets(assignedTo, category, ids, req.user.username);
    }
  }
  let count = 0;
  store.db.assets.forEach(a => {
    if (!ids.has(a.id)) return;
    const prevAssignee = a.assignedTo || STOCK;
    const prevStatus = a.status;
    const prevAssignmentType = a.assignmentType || 'Primary';
    const newStatus = status || a.status;
    const prevDepartment = a.department;
    const newDepartment = departmentForAssignee(assignedTo);
    const newAssignmentType = assignmentType === 'Primary' && selectedByCategory.get(String(a.category || '').trim().toLowerCase()) !== a.id ? 'Temporary' : assignmentType;
    if (assignedTo === prevAssignee && newStatus === prevStatus && newDepartment === prevDepartment && newAssignmentType === prevAssignmentType) return; // nothing to change
    a.assignedTo = assignedTo;
    a.status = newStatus;
    a.department = newDepartment;
    a.assignmentType = newAssignmentType;
    let action = `${isStock(assignedTo) ? 'Checked in' : 'Checked out'} (bulk) · ${prevAssignee} → ${assignedTo}`;
    if (newStatus !== prevStatus) action += ` · status ${prevStatus} → ${newStatus}`;
    if (a.department !== prevDepartment) action += ` · department ${prevDepartment || '—'} → ${a.department}`;
    if (newAssignmentType !== prevAssignmentType) action += ` · type ${prevAssignmentType} → ${newAssignmentType}`;
    if (reason) action += ` · reason: ${reason}`;
    store.pushHistory(a, req.user.username, action, { from: prevAssignee, to: assignedTo });
    count++;
  });
  if (count > 0) store.upsertEmployee(assignedTo);
  store.addLog(req.user.username, `Bulk assigned ${count} item(s) to ${assignedTo}`);
  store.persist();
  res.json({ ok: true, count });
});

app.post('/api/assets/bulk-delete', requireRole('admin'), (req, res) => {
  const ids = new Set(asNumIds(req.body));
  const removed = store.db.assets.filter(a => ids.has(a.id));
  store.db.assets = store.db.assets.filter(a => !ids.has(a.id));
  if (!Array.isArray(store.db.deletedRecords)) store.db.deletedRecords = [];
  for (const record of removed) store.db.deletedRecords.unshift({ id: store.nextId(), type: 'asset', record, deletedAt: new Date().toISOString(), deletedBy: req.user.displayName || req.user.username });
  const count = removed.length;
  store.addLog(req.user.username, `Moved ${count} asset(s) to the recovery archive`);
  store.persist();
  res.json({ ok: true, count });
});

app.post('/api/assets/extend-warranty', canWrite, (req, res) => {
  const ids = new Set(asNumIds(req.body));
  let count = 0;
  store.db.assets.forEach(a => {
    if (ids.has(a.id)) {
      const prevDate = a.warrantyDate || '—';
      // Guard against a malformed stored warrantyDate — basing off Invalid Date
      // would make toISOString() throw a RangeError (500). Fall back to today.
      const base = isValidDate(a.warrantyDate) ? a.warrantyDate : new Date().toISOString().split('T')[0];
      const exp = new Date(base + 'T00:00:00');
      exp.setFullYear(exp.getFullYear() + 1);
      a.warrantyDate = exp.toISOString().split('T')[0];
      store.pushHistory(a, req.user.username, `Warranty extended (+1 year): ${prevDate} → ${a.warrantyDate}`);
      count++;
    }
  });
  store.addLog(req.user.username, `Extended warranty (+1 Year) for ${count} items`);
  store.persist();
  res.json({ ok: true, count });
});

app.post('/api/assets/process-return', canWrite, (req, res) => {
  const ids = new Set(asNumIds(req.body));
  let count = 0;
  store.db.assets.forEach(a => {
    if (ids.has(a.id)) {
      const prevAssignee = a.assignedTo || STOCK;
      const prevDepartment = a.department;
      a.assignedTo = STOCK; a.status = 'In Storage'; a.department = STOCK;
      store.pushHistory(a, req.user.username, `Returned to storage (offboarding) · was assigned to ${prevAssignee}`);
      if (prevDepartment !== a.department) store.pushHistory(a, req.user.username, `Department: ${prevDepartment || '—'} → ${STOCK}`);
      count++;
    }
  });
  store.addLog(req.user.username, `Processed offboarding return: ${count} items returned to storage`);
  store.persist();
  res.json({ ok: true, count });
});

// Persistent, resumable employee offboarding checklists. Each return is saved
// independently so outstanding items survive reloads and interrupted sessions.
app.get('/api/offboarding-checklists', (req, res) => {
  res.json([...(store.db.offboardingChecklists || [])].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
});

app.post('/api/offboarding-checklists', canWrite, (req, res) => {
  const employeeName = clean(req.body.employeeName, 80);
  if (!employeeName) return res.status(400).json({ error: 'Employee name is required.' });
  const existing = (store.db.offboardingChecklists || []).find(c => !c.completedAt && c.employeeName.toLowerCase() === employeeName.toLowerCase());
  if (existing) return res.json(existing);
  const assets = store.db.assets.filter(a => String(a.assignedTo || '').toLowerCase() === employeeName.toLowerCase());
  if (!assets.length) return res.status(400).json({ error: 'This employee has no currently assigned assets to add to a checklist.' });
  const now = new Date().toISOString();
  const checklist = {
    id: store.nextId(), employeeName: assets[0].assignedTo, startedAt: now, updatedAt: now,
    startedBy: req.user.displayName || req.user.username,
    items: assets.map(a => ({ assetId: a.id, name: a.name, category: a.category, serial: a.serial }))
  };
  if (!Array.isArray(store.db.offboardingChecklists)) store.db.offboardingChecklists = [];
  store.db.offboardingChecklists.unshift(checklist);
  store.addLog(req.user.username, `Started offboarding checklist for ${checklist.employeeName} (${assets.length} assets)`);
  store.persist();
  res.status(201).json(checklist);
});

app.post('/api/offboarding-checklists/:id/items/:assetId/return', canWrite, (req, res) => {
  const checklist = (store.db.offboardingChecklists || []).find(c => c.id === Number(req.params.id));
  if (!checklist) return res.status(404).json({ error: 'Offboarding checklist not found.' });
  const item = checklist.items.find(i => i.assetId === Number(req.params.assetId));
  if (!item) return res.status(404).json({ error: 'Asset is not part of this checklist.' });
  if (item.returnedAt) return res.json(checklist);
  const asset = store.db.assets.find(a => a.id === item.assetId);
  if (!asset || String(asset.assignedTo || '').toLowerCase() !== checklist.employeeName.toLowerCase()) {
    return res.status(409).json({ error: 'This asset is no longer assigned to the employee. Refresh the checklist before recording the return.' });
  }
  const allowed = ['charger', 'mouse', 'dockingStation', 'bag', 'adapter'];
  if (req.body.condition !== undefined && !ASSET_CONDITIONS.includes(req.body.condition)) return res.status(400).json({ error: 'Choose a valid return condition.' });
  const rawAccessories = req.body.accessories;
  if (rawAccessories !== undefined && (!rawAccessories || typeof rawAccessories !== 'object' || Array.isArray(rawAccessories) ||
    Object.keys(rawAccessories).some(key => !allowed.includes(key) || typeof rawAccessories[key] !== 'boolean'))) {
    return res.status(400).json({ error: 'Invalid return accessory checklist.' });
  }
  const accessories = Object.fromEntries(allowed.map(key => [key, req.body.accessories?.[key] === true]));
  const condition = ASSET_CONDITIONS.includes(req.body.condition) ? req.body.condition : 'Good';
  const previous = asset.assignedTo || STOCK;
  const previousDepartment = asset.department;
  const returnStatus = condition === 'Good' ? 'In Storage' : 'Under Repair';
  const previousStatus = asset.status;
  asset.assignedTo = STOCK; asset.status = returnStatus; asset.department = STOCK;
  const handoverChecklist = asset.category === 'Laptop' ? { stage: 'returned', accessories } : undefined;
  const confirmed = allowed.filter(key => accessories[key]);
  const accessoryText = handoverChecklist ? ` · return accessories confirmed: ${confirmed.join(', ') || 'none'}` : '';
  store.pushHistory(asset, req.user.username, `Returned through offboarding · status ${previousStatus} → ${returnStatus} · was assigned to ${previous}${accessoryText} · condition at return: ${condition}`, {
    from: previous, to: STOCK, condition, ...(handoverChecklist ? { handoverChecklist } : {})
  });
  if (previousDepartment !== asset.department) store.pushHistory(asset, req.user.username, `Department: ${previousDepartment || '—'} → ${STOCK}`);
  const now = new Date().toISOString();
  item.returnedAt = now;
  item.returnedBy = req.user.displayName || req.user.username;
  item.returnedCondition = condition;
  if (handoverChecklist) item.returnedAccessories = accessories;
  checklist.updatedAt = now;
  if (checklist.items.every(i => i.returnedAt)) {
    checklist.completedAt = now;
    const employee = (store.db.employees || []).find(row => row.name.toLowerCase() === checklist.employeeName.toLowerCase());
    if (employee) {
      const formerAssets = checklist.items.map(checklistItem => {
        const current = store.db.assets.find(row => row.id === checklistItem.assetId);
        if (!current) return null;
        const historical = JSON.parse(JSON.stringify(current));
        historical.assignedTo = employee.name;
        historical.department = employee.department || previousDepartment || '';
        historical.status = 'In Use';
        historical.offboardingCondition = checklistItem.returnedCondition || 'Good';
        return historical;
      }).filter(Boolean);
      if (!Array.isArray(store.db.formerEmployees)) store.db.formerEmployees = [];
      store.db.formerEmployees.unshift({
        id: store.nextId(), name: employee.name, department: employee.department || '', cciId: employee.cciId || '',
        leftAt: now, archivedBy: req.user.displayName || req.user.username, assets: formerAssets
      });
      store.db.employees = store.db.employees.filter(row => row !== employee);
      if (store.db.employeeComments) delete store.db.employeeComments[employee.name];
      store.addLog(req.user.username, `Archived former employee after offboarding: ${employee.name} (${formerAssets.length} asset(s) returned)`);
    }
  }
  store.addLog(req.user.username, `Offboarding return recorded for ${asset.name} (${asset.serial}) — ${checklist.employeeName}`);
  store.persist();
  res.json(checklist);
});

app.post('/api/assets/import', canWrite, (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const added = [];
  const errors = [];
  rows.forEach((row, i) => {
    const mapped = {
      name: row['Item Name'] || row['Model'] || row['name'],
      category: row['Category'] || row['category'] || 'Laptop',
      department: row['Department'] || row['department'] || 'IT',
      serial: row['Serial Number'] || row['serial'],
      assignmentType: row['Assignment Type'] || row['assignmentType'] || 'Primary',
      assignedTo: row['Assigned To'] || row['assignedTo'] || STOCK,
      status: row['Status'] || row['status'] || 'In Use',
      purchaseDate: row['Purchase Date'] || row['purchaseDate'],
      warrantyDate: row['Warranty Date'] || row['warrantyDate']
    };
    const v = validateAsset(mapped, { requireDates: false });
    if (!v.ok) { errors.push(`Row ${i + 1}: ${v.error}`); return; }
    const resolvedAssignee = resolveAssignee(v.value.assignedTo);
    if (!resolvedAssignee) { errors.push(`Row ${i + 1}: ${unknownAssigneeError(v.value.assignedTo)}`); return; }
    v.value.assignedTo = resolvedAssignee;
    v.value.department = departmentForAssignee(resolvedAssignee);
    const dup = store.db.assets.some(a => a.serial.toLowerCase() === v.value.serial.toLowerCase())
      || added.some(a => a.serial.toLowerCase() === v.value.serial.toLowerCase());
    if (dup) { errors.push(`Row ${i + 1}: duplicate serial "${v.value.serial}"`); return; }
    const na = { id: store.nextId(), ...v.value };
    if (na.assignmentType === 'Primary') demoteOtherPrimaryAssets(na.assignedTo, na.category, new Set(), req.user.username, added);
    store.pushHistory(na, req.user.username, `Registered via bulk import · ${na.status} · assigned to ${na.assignedTo || STOCK}`);
    store.upsertEmployee(na.assignedTo, na.department);
    added.push(na);
  });
  store.db.assets.unshift(...added);
  store.addLog(req.user.username, `Imported ${added.length} assets` + (errors.length ? ` (${errors.length} skipped)` : ''));
  store.persist();
  res.json({ ok: true, imported: added.length, skipped: errors.length, errors });
});

// Warranty import: match existing assets by serial and fill in / update their
// purchase + warranty dates. Does NOT create new assets — those come from the
// Entry portal. Rows with an unknown serial are reported as skipped.
app.post('/api/assets/warranty-import', canWrite, (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  let updated = 0;
  const errors = [];
  rows.forEach((row, i) => {
    const serial = clean(row['Serial Number'] || row['Serial'] || row['serial'], 60);
    const purchaseDate = clean(row['Purchase Date'] || row['purchaseDate'], 10);
    const warrantyDate = clean(row['Warranty Date'] || row['Warranty Expiry Date'] || row['warrantyDate'], 10);
    if (!serial) { errors.push(`Row ${i + 1}: missing serial number`); return; }
    const asset = store.db.assets.find(a => a.serial.toLowerCase() === serial.toLowerCase());
    if (!asset) { errors.push(`Row ${i + 1}: no registered asset with serial "${serial}"`); return; }
    if (purchaseDate && !isValidDate(purchaseDate)) { errors.push(`Row ${i + 1}: purchase date must be YYYY-MM-DD`); return; }
    if (warrantyDate && !isValidDate(warrantyDate)) { errors.push(`Row ${i + 1}: warranty date must be YYYY-MM-DD`); return; }
    const newPurchase = purchaseDate || asset.purchaseDate || '';
    const newWarranty = warrantyDate || asset.warrantyDate || '';
    if (isValidDate(newPurchase) && isValidDate(newWarranty) && newWarranty < newPurchase) {
      errors.push(`Row ${i + 1}: warranty date cannot be earlier than the purchase date`); return;
    }
    if (!purchaseDate && !warrantyDate) { errors.push(`Row ${i + 1}: no dates provided`); return; }
    asset.purchaseDate = newPurchase;
    asset.warrantyDate = newWarranty;
    store.pushHistory(asset, req.user.username, `Warranty import · purchase ${newPurchase || '—'}, warranty ${newWarranty || '—'}`);
    updated++;
  });
  store.addLog(req.user.username, `Warranty import: updated ${updated} asset(s)` + (errors.length ? ` (${errors.length} skipped)` : ''));
  store.persist();
  res.json({ ok: true, updated, skipped: errors.length, errors });
});

// ---------------------------------------------------------------- Users (admin)
app.get('/api/users', requireRole('admin'), (req, res) => res.json(store.db.users.map(user => publicUser(user, false))));

app.post('/api/users', requireRole('admin'), async (req, res) => {
  const email = normalizeCompanyEmail(req.body.email);
  const displayName = clean(req.body.displayName, 60);
  const title = clean(req.body.title, 60);
  const pass = String(req.body.pass || '');
  const role = clean(req.body.role, 20);
  if (!displayName) return res.status(400).json({ error: 'Display name is required.' });
  if (!isCompanyEmail(email)) return res.status(400).json({ error: `Enter a valid @${COMPANY_EMAIL_DOMAIN} company email.` });
  if (pass.trim().length < 8 || pass.trim().length > 72) return res.status(400).json({ error: 'Password must be between 8 and 72 characters.' });
  if (!['admin', 'entry', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (store.db.users.some(u => String(u.email || '').toLowerCase() === email || u.username.toLowerCase() === email)) return res.status(409).json({ error: `An account for "${email}" already exists.` });
  const username = email;
  // No shared default security code: an account without an explicit code simply
  // has no self-service password reset (an admin can still reset it here).
  const passHash = await bcrypt.hash(pass.trim(), 12);
  // Hashing is asynchronous to keep the event loop responsive, so recheck the
  // unique account key after the await before committing the new account.
  if (store.db.users.some(u => String(u.email || '').toLowerCase() === email || u.username.toLowerCase() === email)) {
    return res.status(409).json({ error: `An account for "${email}" already exists.` });
  }
  const user = { username, email, displayName, title, passHash, role };
  store.db.users.push(user);
  store.addLog(req.user.username, `Created user account for '${email}'`);
  store.persist();
  res.status(201).json(publicUser(user));
});

app.put('/api/users/:username', requireRole('admin'), async (req, res) => {
  const user = findUser(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const changes = [];
  let nextEmail;
  let nextDisplayName;
  let nextRole;
  let nextTitle;
  let nextPassHash;
  if (req.body.email !== undefined) {
    nextEmail = normalizeCompanyEmail(req.body.email);
    if (!isCompanyEmail(nextEmail)) return res.status(400).json({ error: `Enter a valid @${COMPANY_EMAIL_DOMAIN} company email.` });
    if (store.db.users.some(u => u !== user && String(u.email || '').toLowerCase() === nextEmail)) return res.status(409).json({ error: `An account for "${nextEmail}" already exists.` });
    if (String(user.email || '').toLowerCase() !== nextEmail) changes.push('company email updated');
  }
  if (req.body.displayName !== undefined) {
    nextDisplayName = clean(req.body.displayName, 60);
    if (!nextDisplayName) return res.status(400).json({ error: 'Display name is required.' });
    if (nextDisplayName !== user.displayName) changes.push('display name updated');
  }
  if (req.body.title !== undefined) {
    nextTitle = clean(req.body.title, 60);
    if (nextTitle !== String(user.title || '')) changes.push('title updated');
  }
  let nextPermissions;
  if (req.body.permissions !== undefined) {
    if (user.role === 'admin' && req.body.permissions !== null) return res.status(400).json({ error: 'Admin accounts retain full access and cannot have a restricted permission override.' });
    if (req.body.permissions !== null && (!Array.isArray(req.body.permissions) || req.body.permissions.length > ALL_PERMISSIONS.length || req.body.permissions.some(key => typeof key !== 'string' || !ALL_PERMISSIONS.includes(key)))) {
      return res.status(400).json({ error: 'Choose valid permissions from the access panel.' });
    }
    if (req.body.permissions != null && user.role !== 'admin' && req.body.permissions.some(key => key === 'users.manage' || key === 'backup.manage')) {
      return res.status(403).json({ error: 'User management and backup access are reserved for Admin accounts.' });
    }
    if (req.body.permissions != null && user.role !== 'admin' && !req.body.permissions.includes('dashboard.view')) {
      return res.status(400).json({ error: 'Dashboard view must remain enabled as the account landing page.' });
    }
    nextPermissions = req.body.permissions === null ? null : [...new Set(req.body.permissions)];
    const current = Array.isArray(user.permissions) ? user.permissions.slice().sort().join(',') : null;
    const next = nextPermissions === null ? null : nextPermissions.slice().sort().join(',');
    if (current !== next) changes.push(next === null ? 'custom permissions reset to role defaults' : 'individual permissions updated');
  }
  // Role update (optional). The primary admin cannot be demoted — that would risk
  // locking everyone out of admin functions.
  if (req.body.role !== undefined) {
    nextRole = clean(req.body.role, 20);
    if (!['admin', 'entry', 'viewer'].includes(nextRole)) return res.status(400).json({ error: 'Invalid role.' });
    if (user.username.toLowerCase() === 'admin' && nextRole !== 'admin') {
      return res.status(400).json({ error: 'The primary admin account must remain an Admin.' });
    }
    if (nextRole !== user.role) changes.push(`role → ${nextRole}`);
  }
  // Password reset (optional) — only when a non-empty new password is supplied.
  if (req.body.pass !== undefined && String(req.body.pass).trim() !== '') {
    const pass = String(req.body.pass).trim();
    if (pass.length < 8 || pass.length > 72) return res.status(400).json({ error: 'Password must be between 8 and 72 characters.' });
    nextPassHash = await bcrypt.hash(pass, 10);
    changes.push('password reset');
  }
  if (changes.length === 0) return res.json(publicUser(user));
  // Another request may have claimed this address while password hashing was
  // yielding to the event loop; keep email uniqueness enforced at commit time.
  if (nextEmail !== undefined && store.db.users.some(u => u !== user && String(u.email || '').toLowerCase() === nextEmail)) {
    return res.status(409).json({ error: `An account for "${nextEmail}" already exists.` });
  }
  if (nextEmail !== undefined) user.email = nextEmail;
  if (nextDisplayName !== undefined) user.displayName = nextDisplayName;
  if (nextTitle !== undefined) user.title = nextTitle;
  if (nextPermissions !== undefined) {
    if (nextPermissions === null) delete user.permissions;
    else user.permissions = nextPermissions;
  }
  if (nextRole !== undefined) user.role = nextRole;
  if (nextPassHash !== undefined) user.passHash = nextPassHash;
  store.addLog(req.user.username, `Updated user '${user.username}': ${changes.join(', ')}`);
  store.persist();
  res.json(publicUser(user));
});

app.delete('/api/users/:username', requireRole('admin'), (req, res) => {
  const uname = String(req.params.username).toLowerCase();
  if (uname === 'admin') return res.status(400).json({ error: 'The primary admin account is protected.' });
  if (uname === String(req.user.username).toLowerCase()) return res.status(400).json({ error: 'You cannot delete your own account.' });
  const before = store.db.users.length;
  store.db.users = store.db.users.filter(u => u.username.toLowerCase() !== uname);
  if (store.db.users.length === before) return res.status(404).json({ error: 'User not found.' });
  store.addLog(req.user.username, `Deleted user: '${req.params.username}'`);
  store.persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Logs
// All authenticated users can review the activity trail; only admins can clear it.
app.get('/api/logs', (req, res) => res.json(store.db.logs));

// Keep authentication events independently searchable even when routine audit
// entries roll out of the shorter Activity Trail retention window.
app.get('/api/sign-in-events', requireRole('admin'), (req, res) => {
  const events = store.db.signInEvents || [];
  const actors = new Set(events.map(event => String(event.user || '').toLowerCase()));
  const profiles = store.db.users
    .filter(user => actors.has(String(user.username || '').toLowerCase()) && user.profileImage)
    .map(user => ({ username: user.username, email: user.email || '', displayName: user.displayName || '', profileImage: user.profileImage }));
  res.json({ events, profiles });
});

app.get('/api/dropdown-options', (req, res) => res.json(store.dropdownOptions));
app.put('/api/dropdown-options', (req, res) => {
  const checked = store.validateDropdownOptions(req.body);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const next = checked.value;
  const current = store.dropdownOptions;
  const removed = (before, after) => before.filter(item => !after.includes(item));
  const removedCategories = removed(current.assetCategories, next.assetCategories);
  const assets = [...(store.db.assets || []), ...(store.db.formerEmployees || []).flatMap(row => row.assets || [])];
  for (const category of removedCategories) if (assets.some(row => row.category === category)) return res.status(409).json({ error: `Cannot remove ${category}; it is used by saved assets.` });
  for (const category of current.assetCategories) {
    const removedModels = removed(current.assetModels[category] || [], next.assetModels[category] || []);
    for (const model of removedModels) {
      if (assets.some(row => row.category === category && row.name === model) || (store.db.deskPeripherals || []).some(row => row.category === category && row.model === model) || (store.db.dellCases || []).some(row => row.category === category && row.assetModel === model)) return res.status(409).json({ error: `Cannot remove ${model}; it is used by a saved asset, desk setup, or Dell case.` });
    }
  }
  for (const row of store.db.deskPeripherals || []) if (!next.deskCategories.includes(row.category) || !(next.assetModels[row.category] || []).includes(row.model)) return res.status(409).json({ error: `Cannot remove ${row.category} / ${row.model}; it is used by Desk Setup.` });
  for (const row of store.db.dellCases || []) {
    const category = row.category || current.assetCategories.find(item => (current.assetModels[item] || []).includes(row.assetModel)) || assets.find(asset => asset.name === row.assetModel)?.category;
    if (category && (!next.assetCategories.includes(category) || !(next.assetModels[category] || []).includes(row.assetModel))) return res.status(409).json({ error: `Cannot remove ${category} / ${row.assetModel}; it is used by a Dell case.` });
  }
  const removedConsumableCategories = removed(current.consumableCategories, next.consumableCategories);
  const removedUnits = removed(current.consumableUnits, next.consumableUnits);
  for (const row of store.db.consumables || []) {
    if (removedConsumableCategories.includes(row.category)) return res.status(409).json({ error: `Cannot remove ${row.category}; it is used by a saved consumable.` });
    if (removedUnits.includes(row.unit)) return res.status(409).json({ error: `Cannot remove ${row.unit}; it is used by a saved consumable.` });
  }
  store.db.dropdownOptions = next;
  store.addLog(req.user.username, 'Updated managed dropdown options');
  store.persist();
  res.json(next);
});

app.delete('/api/logs', requireRole('admin'), (req, res) => {
  store.db.logs = [];
  store.persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Consumables (admin)
// Quantity-tracked stock (cables, adapters, keyboards…) kept separate from the
// serial-tracked assets collection. Reads are open to any authenticated user so
// the dashboard/reports can surface low stock; all writes are admin-only.
const adminOnly = requireRole('admin');

app.get('/api/consumables', (req, res) => res.json(store.db.consumables || []));

app.post('/api/consumables', adminOnly, (req, res) => {
  const v = validateConsumable(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  if ((store.db.consumables || []).some(c => c.name.toLowerCase() === v.value.name.toLowerCase() && c.location.toLowerCase() === v.value.location.toLowerCase())) {
    return res.status(409).json({ error: `"${v.value.name}" already exists at that location.` });
  }
  const item = { id: store.nextId(), ...v.value, updatedAt: new Date().toISOString() };
  store.db.consumables.unshift(item);
  store.addLog(req.user.username, `Added consumable: ${item.name} (qty ${item.quantity})`);
  store.persist();
  res.status(201).json(item);
});

app.post('/api/consumables/import', adminOnly, (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const errors = []; let imported = 0;
  for (const [index, row] of rows.entries()) {
    const pick = (...keys) => keys.map(k => row?.[k]).find(v => v !== undefined && v !== null);
    const v = validateConsumable({ name: pick('Name', 'Item', 'Item Name', 'name'), category: pick('Category', 'category'), quantity: pick('Quantity', 'quantity'), unit: pick('Unit', 'unit'), reorderThreshold: pick('Reorder Threshold', 'Reorder Point', 'reorderThreshold'), location: pick('Location', 'location'), notes: pick('Notes', 'notes') });
    if (!v.ok) { errors.push(`Row ${index + 2}: ${v.error}`); continue; }
    const duplicate = (store.db.consumables || []).some(c => c.name.toLowerCase() === v.value.name.toLowerCase() && c.location.toLowerCase() === v.value.location.toLowerCase());
    if (duplicate) { errors.push(`Row ${index + 2}: "${v.value.name}" already exists at that location.`); continue; }
    store.db.consumables.unshift({ id: store.nextId(), ...v.value, updatedAt: new Date().toISOString() }); imported++;
  }
  if (imported) { store.addLog(req.user.username, `Imported ${imported} consumable item(s)`); store.persist(); }
  res.json({ imported, skipped: errors.length, errors });
});

app.put('/api/consumables/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const item = (store.db.consumables || []).find(c => c.id === id);
  if (!item) return res.status(404).json({ error: 'Consumable not found.' });
  const v = validateConsumable(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  if ((store.db.consumables || []).some(other => other.id !== id && other.name.toLowerCase() === v.value.name.toLowerCase() && other.location.toLowerCase() === v.value.location.toLowerCase())) {
    return res.status(409).json({ error: `"${v.value.name}" already exists at that location.` });
  }
  Object.assign(item, v.value, { updatedAt: new Date().toISOString() });
  store.addLog(req.user.username, `Updated consumable: ${item.name} (qty ${item.quantity})`);
  store.persist();
  res.json(item);
});

// Quick stock adjustment (+/-). Body: { delta: number, reason?: string }.
app.post('/api/consumables/:id/adjust', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const item = (store.db.consumables || []).find(c => c.id === id);
  if (!item) return res.status(404).json({ error: 'Consumable not found.' });
  const delta = Number(req.body.delta);
  if (!Number.isInteger(delta) || delta === 0) return res.status(400).json({ error: 'Adjustment amount must be a non-zero whole number.' });
  const next = item.quantity + delta;
  if (next < 0) return res.status(400).json({ error: 'Adjustment would make stock negative.' });
  if (next > 1000000) return res.status(400).json({ error: 'Adjustment would exceed the maximum stock quantity of 1,000,000.' });
  item.quantity = next;
  item.updatedAt = new Date().toISOString();
  store.addLog(req.user.username, `Adjusted stock: ${item.name} ${delta > 0 ? '+' : ''}${delta} → ${item.quantity}`);
  store.persist();
  res.json(item);
});

app.delete('/api/consumables/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const index = (store.db.consumables || []).findIndex(c => c.id === id);
  if (index < 0) return res.status(404).json({ error: 'Consumable not found.' });
  const [record] = store.db.consumables.splice(index, 1);
  if (!Array.isArray(store.db.deletedRecords)) store.db.deletedRecords = [];
  store.db.deletedRecords.unshift({ id: store.nextId(), type: 'consumable', record, deletedAt: new Date().toISOString(), deletedBy: req.user.displayName || req.user.username });
  store.addLog(req.user.username, `Moved consumable ${record.name} to the recovery archive`);
  store.persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Desk monitor / dock setups
app.get('/api/desk-peripherals', (req, res) => res.json(store.db.deskPeripherals || []));

const DESK_CATEGORIES = ['Monitor', 'Docking Station'];
function validateDeskPeripheral(body, existingId = null) {
  const record = {
    deskNo: clean(body.deskNo, 40),
    category: clean(body.category, 40),
    model: clean(body.model, 100),
    serial: clean(body.serial, 100)
  };
  if (!record.deskNo || !record.category || !record.model || !record.serial) return { error: 'Desk number, category, item model/name, and serial number are required.' };
  if (!store.dropdownOptions.deskCategories.includes(record.category)) return { error: 'Category must be Monitor or Docking Station.' };
  const models = store.dropdownOptions.assetModels[record.category] || [];
  if (!models.includes(record.model)) return { error: 'Select a valid item model/name for the chosen category.' };
  const otherRows = (store.db.deskPeripherals || []).filter(row => row.id !== existingId);
  if (otherRows.some(row => String(row.serial || '').toLowerCase() === record.serial.toLowerCase())) return { error: 'That serial number is already used on another desk item.' };
  return { value: record };
}

app.post('/api/desk-peripherals', canWrite, (req, res) => {
  const validated = validateDeskPeripheral(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const record = { id: store.nextId(), ...validated.value };
  store.db.deskPeripherals.unshift(record);
  store.addLog(req.user.username, `Added desk setup: ${record.deskNo}`);
  store.persist();
  res.status(201).json(record);
});

app.post('/api/desk-peripherals/import', canWrite, (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const added = [];
  const errors = [];
  rows.forEach((row, i) => {
    const mapped = {
      deskNo: row['Desk No.'] || row['Desk No'] || row['deskNo'],
      category: row['Category'] || row['category'],
      model: row['Item Model'] || row['Item Model / Name'] || row['Model'] || row['model'],
      serial: row['Serial Number'] || row['Serial'] || row['serial']
    };
    const v = validateDeskPeripheral(mapped);
    if (v.error) { errors.push(`Row ${i + 1}: ${v.error}`); return; }
    if (added.some(r => r.serial.toLowerCase() === v.value.serial.toLowerCase())) {
      errors.push(`Row ${i + 1}: duplicate serial "${v.value.serial}"`); return;
    }
    added.push({ id: store.nextId(), ...v.value });
  });
  store.db.deskPeripherals.unshift(...added);
  store.addLog(req.user.username, `Imported ${added.length} desk setup(s)` + (errors.length ? ` (${errors.length} skipped)` : ''));
  store.persist();
  res.json({ ok: true, imported: added.length, skipped: errors.length, errors });
});

app.put('/api/desk-peripherals/:id', canWrite, (req, res) => {
  const id = Number(req.params.id);
  const record = (store.db.deskPeripherals || []).find(row => row.id === id);
  if (!record) return res.status(404).json({ error: 'Desk setup not found.' });
  const validated = validateDeskPeripheral(req.body, id);
  if (validated.error) return res.status(400).json({ error: validated.error });
  Object.assign(record, validated.value);
  store.addLog(req.user.username, `Updated desk setup: ${record.deskNo}`);
  store.persist();
  res.json(record);
});

app.delete('/api/desk-peripherals/:id', canWrite, (req, res) => {
  const id = Number(req.params.id);
  const index = (store.db.deskPeripherals || []).findIndex(row => row.id === id);
  if (index < 0) return res.status(404).json({ error: 'Desk setup not found.' });
  const [removed] = store.db.deskPeripherals.splice(index, 1);
  if (!Array.isArray(store.db.deletedRecords)) store.db.deletedRecords = [];
  store.db.deletedRecords.unshift({ id: store.nextId(), type: 'deskPeripheral', record: removed, deletedAt: new Date().toISOString(), deletedBy: req.user.displayName || req.user.username });
  store.addLog(req.user.username, `Moved desk setup ${removed.deskNo} to the recovery archive`);
  store.persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Former employees (offboarding archive)
app.get('/api/former-employees', (req, res) => res.json(store.db.formerEmployees || []));

app.post('/api/former-employees/:name/archive', canWrite, (req, res) => {
  const name = empKey(req.params.name);
  const employee = (store.db.employees || []).find(row => row.name.toLowerCase() === name.toLowerCase());
  if (!employee) return res.status(404).json({ error: 'Active employee not found.' });
  const assigned = store.db.assets.filter(asset => (asset.assignedTo || '').toLowerCase() === employee.name.toLowerCase());
  const snapshot = {
    id: store.nextId(), name: employee.name, department: employee.department || '', cciId: employee.cciId || '',
    leftAt: new Date().toISOString(), archivedBy: req.user.displayName || req.user.username,
    assets: JSON.parse(JSON.stringify(assigned))
  };
  for (const asset of assigned) {
    const previousAssignee = asset.assignedTo;
    asset.assignedTo = STOCK;
    asset.status = 'In Storage';
    asset.department = STOCK;
    store.pushHistory(asset, req.user.username, `Returned to storage after ${employee.name} left the company`, { from: previousAssignee, to: STOCK });
  }
  store.db.formerEmployees.unshift(snapshot);
  store.db.employees = store.db.employees.filter(row => row !== employee);
  if (store.db.employeeComments) delete store.db.employeeComments[employee.name];
  store.addLog(req.user.username, `Archived former employee: ${employee.name} (${assigned.length} asset(s) returned)`);
  store.persist();
  res.status(201).json(snapshot);
});

// ---------------------------------------------------------------- Dell support cases
const DELL_CASE_STATUSES = ['Resolved', 'Unresolved', 'Closed without resolved'];
function validateDellCase(body) {
  const value = {
    employeeName: clean(body.employeeName, 100),
    category: clean(body.category, 50),
    assetModel: clean(body.assetModel, 120),
    assetSerial: clean(body.assetSerial, 100),
    registeredDate: String(body.registeredDate || '').trim(),
    caseId: clean(body.caseId, 80),
    issueDescription: cleanMultiline(body.issueDescription, 1000),
    registeredBy: clean(body.registeredBy, 100),
    status: clean(body.status, 40)
  };
  if (!value.employeeName || !value.assetModel || !value.assetSerial || !value.registeredDate || !value.caseId || !value.issueDescription || !value.registeredBy || !value.status) {
    return { error: 'Complete all Dell case fields.' };
  }
  if (!value.category) {
    const trackedAssets = [
      ...(store.db.assets || []),
      ...(store.db.formerEmployees || []).flatMap(employee => Array.isArray(employee.assets) ? employee.assets : [])
    ];
    value.category = store.dropdownOptions.assetCategories.find(category => (store.dropdownOptions.assetModels[category] || []).includes(value.assetModel)) ||
      trackedAssets.find(asset => String(asset.name || '').toLowerCase() === value.assetModel.toLowerCase())?.category || '';
  }
  if (!store.dropdownOptions.assetCategories.includes(value.category)) return { error: 'Choose a valid asset category.' };
  const employeeName = isStock(value.employeeName) ? STOCK :
    (store.db.employees || []).find(employee => employee.name.toLowerCase() === value.employeeName.toLowerCase())?.name ||
    (store.db.formerEmployees || []).find(employee => employee.name.toLowerCase() === value.employeeName.toLowerCase())?.name;
  if (!employeeName) return { error: `Employee "${value.employeeName}" is not in Manage Employees or Former Employees.` };
  value.employeeName = employeeName;
  const trackedAssets = [
    ...(store.db.assets || []),
    ...(store.db.formerEmployees || []).flatMap(employee => Array.isArray(employee.assets) ? employee.assets : [])
  ];
  const trackedSerial = trackedAssets.find(asset => String(asset.serial || '').trim().toLowerCase() === value.assetSerial.toLowerCase());
  const knownModel = (store.dropdownOptions.assetModels[value.category] || []).includes(value.assetModel) ||
    trackedAssets.some(asset => asset.category === value.category && asset.name.toLowerCase() === value.assetModel.toLowerCase());
  if (!knownModel) return { error: 'Choose a model that belongs to the selected category.' };
  if (trackedSerial && (trackedSerial.category !== value.category || trackedSerial.name.toLowerCase() !== value.assetModel.toLowerCase())) {
    return { error: `Serial ${value.assetSerial} belongs to ${trackedSerial.name} (${trackedSerial.category}), not the selected model and category.` };
  }
  if (!isValidDate(value.registeredDate)) return { error: 'Enter a valid case registration date.' };
  if (!DELL_CASE_STATUSES.includes(value.status)) return { error: 'Choose a valid Dell case status.' };
  return { value };
}

app.get('/api/dell-cases', (req, res) => res.json((store.db.dellCases || []).map(publicDellCase)));

app.post('/api/dell-cases/import', canWrite, (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const errors = []; let imported = 0;
  for (const [index, row] of rows.entries()) {
    const pick = (...keys) => keys.map(k => row?.[k]).find(v => v !== undefined && v !== null);
    const validated = validateDellCase({ employeeName: pick('Employee', 'Employee Name', 'employeeName'), category: pick('Category', 'category'), assetModel: pick('Item Model / Name', 'Asset Model', 'Asset', 'assetModel'), assetSerial: pick('Asset Serial No.', 'Serial No.', 'Serial Number', 'assetSerial'), registeredDate: pick('Case Registered Date', 'Registered Date', 'Registered', 'registeredDate'), caseId: pick('Case ID', 'caseId'), issueDescription: pick('Issue Description', 'Issue', 'issueDescription'), registeredBy: pick('Registered By', 'registeredBy'), status: pick('Status', 'status') });
    if (validated.error) { errors.push(`Row ${index + 2}: ${validated.error}`); continue; }
    if ((store.db.dellCases || []).some(c => c.caseId.toLowerCase() === validated.value.caseId.toLowerCase())) { errors.push(`Row ${index + 2}: Case ID ${validated.value.caseId} already exists.`); continue; }
    store.db.dellCases.unshift({ id: store.nextId(), ...validated.value, updatedAt: new Date().toISOString() }); imported++;
  }
  if (imported) { store.addLog(req.user.username, `Imported ${imported} Dell case(s)`); store.persist(); }
  res.json({ imported, skipped: errors.length, errors });
});

app.post('/api/dell-cases', canWrite, (req, res) => {
  const validated = validateDellCase(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  if ((store.db.dellCases || []).some(row => row.caseId.toLowerCase() === validated.value.caseId.toLowerCase())) {
    return res.status(409).json({ error: 'A Dell case with that case ID already exists.' });
  }
  const record = { id: store.nextId(), ...validated.value, updatedAt: new Date().toISOString() };
  store.db.dellCases.unshift(record);
  store.addLog(req.user.username, `Registered Dell case ${record.caseId} for ${record.assetSerial}`);
  store.persist();
  res.status(201).json(record);
});

app.put('/api/dell-cases/:id', canWrite, (req, res) => {
  const row = (store.db.dellCases || []).find(item => item.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Dell case not found.' });
  const validated = validateDellCase(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  if ((store.db.dellCases || []).some(item => item.id !== row.id && item.caseId.toLowerCase() === validated.value.caseId.toLowerCase())) {
    return res.status(409).json({ error: 'A Dell case with that case ID already exists.' });
  }
  Object.assign(row, validated.value, { updatedAt: new Date().toISOString() });
  store.addLog(req.user.username, `Updated Dell case ${row.caseId}`);
  store.persist();
  res.json(row);
});

app.delete('/api/dell-cases/:id', canWrite, (req, res) => {
  const index = (store.db.dellCases || []).findIndex(item => item.id === Number(req.params.id));
  if (index < 0) return res.status(404).json({ error: 'Dell case not found.' });
  const [removed] = store.db.dellCases.splice(index, 1);
  if (!Array.isArray(store.db.deletedRecords)) store.db.deletedRecords = [];
  store.db.deletedRecords.unshift({ id: store.nextId(), type: 'dellCase', record: removed, deletedAt: new Date().toISOString(), deletedBy: req.user.displayName || req.user.username });
  store.addLog(req.user.username, `Moved Dell case ${removed.caseId} to the recovery archive`);
  store.persist();
  res.json({ ok: true });
});

app.post('/api/dell-cases/:id/comments', canWrite, (req, res) => {
  const row = (store.db.dellCases || []).find(item => item.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Dell case not found.' });
  const text = cleanMultiline(req.body.text, 500);
  if (!text) return res.status(400).json({ error: 'Comment text is required.' });
  if (!Array.isArray(row.comments)) row.comments = [];
  const id = row.comments.length ? Math.max(...row.comments.map(comment => Number(comment.id) || 0)) + 1 : 1;
  const comment = { id, ts: new Date().toISOString(), user: req.user.username, text };
  row.comments.unshift(comment);
  store.addLog(req.user.username, `Commented on Dell case ${row.caseId}`);
  store.persist();
  res.status(201).json(publicComment(comment));
});

app.put('/api/dell-cases/:id/comments/:commentId', canWrite, (req, res) => {
  const row = (store.db.dellCases || []).find(item => item.id === Number(req.params.id));
  if (!row || !Array.isArray(row.comments)) return res.status(404).json({ error: 'Dell case or comment not found.' });
  const comment = row.comments.find(item => item.id === Number(req.params.commentId));
  if (!comment) return res.status(404).json({ error: 'Comment not found.' });
  if (req.user.role !== 'admin' && comment.user !== req.user.username) return res.status(403).json({ error: 'You can only edit your own comments.' });
  const text = cleanMultiline(req.body.text, 500);
  if (!text) return res.status(400).json({ error: 'Comment text is required.' });
  comment.text = text;
  comment.editedTs = new Date().toISOString();
  store.addLog(req.user.username, `Edited a comment on Dell case ${row.caseId}`);
  store.persist();
  res.json(comment);
});

app.delete('/api/dell-cases/:id/comments/:commentId', canWrite, (req, res) => {
  const row = (store.db.dellCases || []).find(item => item.id === Number(req.params.id));
  if (!row || !Array.isArray(row.comments)) return res.status(404).json({ error: 'Dell case or comment not found.' });
  const index = row.comments.findIndex(item => item.id === Number(req.params.commentId));
  if (index < 0) return res.status(404).json({ error: 'Comment not found.' });
  if (req.user.role !== 'admin' && row.comments[index].user !== req.user.username) return res.status(403).json({ error: 'You can only delete your own comments.' });
  row.comments.splice(index, 1);
  store.addLog(req.user.username, `Deleted a comment on Dell case ${row.caseId}`);
  store.persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Shared quick links
app.get('/api/links', (req, res) => res.json((store.db.quickLinks || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))));

app.post('/api/links/import', canWrite, (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const errors = []; let imported = 0;
  for (const [index, row] of rows.entries()) {
    const pick = (...keys) => keys.map(key => row?.[key]).find(value => value !== undefined && value !== null);
    const name = clean(pick('Name', 'Link Name', 'name'), 100);
    const purpose = clean(pick('Purpose', 'What is this link for?', 'purpose') || '', 300);
    const rawUrl = clean(pick('URL', 'Link', 'url'), 1000);
    if (!name) { errors.push(`Row ${index + 2}: Link name is required.`); continue; }
    let url;
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('unsupported');
      url = parsed.toString();
    } catch { errors.push(`Row ${index + 2}: Enter a valid URL starting with http:// or https://.`); continue; }
    if ((store.db.quickLinks || []).some(link => link.name.toLowerCase() === name.toLowerCase() && link.url === url)) {
      errors.push(`Row ${index + 2}: That link already exists.`); continue;
    }
    store.db.quickLinks.unshift({ id: store.nextId(), name, url, purpose, createdBy: req.user.username, createdAt: new Date().toISOString() });
    imported++;
  }
  if (imported) { store.addLog(req.user.username, `Imported ${imported} shared link(s)`); store.persist(); }
  res.json({ imported, skipped: errors.length, errors });
});

app.post('/api/links', canWrite, (req, res) => {
  const name = clean(req.body.name, 100);
  const purpose = clean(req.body.purpose, 300);
  const rawUrl = clean(req.body.url, 1000);
  if (!name || !rawUrl) return res.status(400).json({ error: 'Enter a link name and URL.' });
  let url;
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('unsupported');
    url = parsed.toString();
  } catch {
    return res.status(400).json({ error: 'Enter a valid website URL starting with http:// or https://.' });
  }
  if ((store.db.quickLinks || []).some(link => link.name.toLowerCase() === name.toLowerCase() && link.url === url)) {
    return res.status(409).json({ error: 'That link has already been added.' });
  }
  const link = { id: store.nextId(), name, url, purpose, createdBy: req.user.username, createdAt: new Date().toISOString() };
  store.db.quickLinks.unshift(link);
  store.addLog(req.user.username, `Added shared link: ${link.name}`);
  store.persist();
  res.status(201).json(link);
});

app.delete('/api/links/:id', canWrite, (req, res) => {
  const link = (store.db.quickLinks || []).find(item => item.id === Number(req.params.id));
  if (!link) return res.status(404).json({ error: 'Link not found.' });
  if (req.user.role !== 'admin' && link.createdBy !== req.user.username) return res.status(403).json({ error: 'Only the link creator or an admin can remove this link.' });
  store.db.quickLinks = store.db.quickLinks.filter(item => item.id !== link.id);
  if (!Array.isArray(store.db.deletedRecords)) store.db.deletedRecords = [];
  store.db.deletedRecords.unshift({ id: store.nextId(), type: 'quickLink', record: link, deletedAt: new Date().toISOString(), deletedBy: req.user.displayName || req.user.username });
  store.addLog(req.user.username, `Moved shared link ${link.name} to the recovery archive`);
  store.persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Backup / Restore (admin)
// A manual safety net: an admin can download a JSON snapshot of the asset data and
// re-import it later. The snapshot deliberately EXCLUDES user accounts and
// credentials — a restore only replaces assets, employee notes and audit logs, so
// it can never leak password hashes or lock anyone out of the app.
app.get('/api/backup', requireRole('admin'), (req, res) => {
  const snapshot = {
    type: 'assetflow-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: req.user.username,
    seq: store.db.seq || 1000,
    assets: store.db.assets,
    employeeComments: store.db.employeeComments || {},
    consumables: store.db.consumables || [],
    deskPeripherals: store.db.deskPeripherals || [],
    formerEmployees: store.db.formerEmployees || [],
    offboardingChecklists: store.db.offboardingChecklists || [],
    dellCases: store.db.dellCases || [],
    quickLinks: store.db.quickLinks || [],
    employees: store.db.employees || [],
    deletedRecords: store.db.deletedRecords || [],
    logs: store.db.logs,
    signInEvents: store.db.signInEvents || [],
    dropdownOptions: store.dropdownOptions
  };
  store.addLog(req.user.username, 'Downloaded a data backup snapshot');
  store.persist();
  res.json(snapshot);
});

app.post('/api/restore', requireRole('admin'), (req, res) => {
  const snap = req.body || {};
  if (!Array.isArray(snap.assets)) {
    return res.status(400).json({ error: 'Invalid backup file — no "assets" array found.' });
  }
  if (snap.dropdownOptions != null) {
    const dropdowns = store.validateDropdownOptions(snap.dropdownOptions);
    if (dropdowns.error) return res.status(400).json({ error: `Invalid dropdown options in backup: ${dropdowns.error}` });
    store.db.dropdownOptions = dropdowns.value;
  }
  // Re-validate every asset so a hand-edited or foreign file can't inject junk;
  // invalid rows are skipped rather than aborting the whole restore.
  const cleanAssets = [];
  const seenSerials = new Set();
  const seenIds = new Set();
  for (const raw of snap.assets) {
    const v = validateAsset(raw, { requireDates: false });
    if (!v.ok) continue;
    const key = v.value.serial.toLowerCase();
    if (seenSerials.has(key)) continue; // drop duplicate serials
    seenSerials.add(key);
    // Dedupe ids too: a hand-edited file could reuse an id across rows, which
    // would break per-id lookups/updates after restore.
    let id = Number(raw.id);
    if (!Number.isInteger(id) || id <= 0 || seenIds.has(id)) id = store.nextId();
    seenIds.add(id);
    const asset = { id, ...v.value };
    if (Array.isArray(raw.history)) asset.history = raw.history.map(normalizeStockHistory);
    if (Array.isArray(raw.comments)) asset.comments = raw.comments;
    cleanAssets.push(asset);
  }
  const skipped = snap.assets.length - cleanAssets.length;
  store.db.assets = cleanAssets;
  if (snap.employeeComments && typeof snap.employeeComments === 'object' && !Array.isArray(snap.employeeComments)) {
    store.db.employeeComments = snap.employeeComments;
  }
  // Restore consumables (re-validated), if present in the snapshot.
  if (Array.isArray(snap.consumables)) {
    const cleanConsumables = [];
    for (const raw of snap.consumables) {
      const cv = validateConsumable(raw);
      if (!cv.ok) continue;
      cleanConsumables.push({ id: Number(raw.id) || store.nextId(), ...cv.value, updatedAt: raw.updatedAt || new Date().toISOString() });
    }
    store.db.consumables = cleanConsumables;
  }
  if (Array.isArray(snap.deskPeripherals)) {
    store.db.deskPeripherals = [];
    for (const raw of snap.deskPeripherals) {
      for (const row of store.expandLegacyDeskRow(raw)) {
        const validated = validateDeskPeripheral(row);
        if (!validated.error) store.db.deskPeripherals.push({ id: store.nextId(), ...validated.value });
      }
    }
  }
  if (Array.isArray(snap.offboardingChecklists)) {
    const safeChecklists = [];
    const usedChecklistIds = new Set();
    for (const raw of snap.offboardingChecklists) {
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) continue;
      const employeeName = clean(raw.employeeName, 80);
      if (!employeeName) continue;
      let id = Number(raw.id);
      if (!Number.isInteger(id) || id <= 0 || usedChecklistIds.has(id)) id = store.nextId();
      usedChecklistIds.add(id);
      const items = raw.items.filter(item => item && Number.isInteger(Number(item.assetId)))
        .map(item => ({
          assetId: Number(item.assetId), name: clean(item.name, 120), category: clean(item.category, 40), serial: clean(item.serial, 80),
          ...(item.returnedAt ? { returnedAt: clean(item.returnedAt, 40) } : {}),
          ...(item.returnedBy ? { returnedBy: clean(item.returnedBy, 80) } : {}),
          ...(ASSET_CONDITIONS.includes(item.returnedCondition) ? { returnedCondition: item.returnedCondition } : {}),
          ...(item.returnedAccessories && typeof item.returnedAccessories === 'object' ? { returnedAccessories: Object.fromEntries(['charger', 'mouse', 'dockingStation', 'bag', 'adapter'].map(key => [key, item.returnedAccessories[key] === true])) } : {})
        }));
      if (!items.length) continue;
      safeChecklists.push({
        id, employeeName, startedAt: clean(raw.startedAt, 40) || new Date().toISOString(),
        updatedAt: clean(raw.updatedAt, 40) || new Date().toISOString(), startedBy: clean(raw.startedBy, 80) || 'Unknown',
        ...(raw.completedAt ? { completedAt: clean(raw.completedAt, 40) } : {}), items
      });
    }
    store.db.offboardingChecklists = safeChecklists;
  }
  if (Array.isArray(snap.formerEmployees)) {
    store.db.formerEmployees = snap.formerEmployees
      .filter(row => row && row.name && Array.isArray(row.assets))
      .map(row => ({
        id: Number(row.id) || store.nextId(), name: clean(row.name, 100), department: clean(row.department, 40),
        cciId: clean(row.cciId, 30), leftAt: row.leftAt || new Date().toISOString(),
        archivedBy: clean(row.archivedBy, 100) || 'Imported backup', assets: JSON.parse(JSON.stringify(row.assets)).map(normalizeStockAsset)
      }));
  }
  if (Array.isArray(snap.employees)) {
    const seenEmployeeNames = new Set();
    const seenCciIds = new Set();
    store.db.employees = snap.employees
      .map(e => {
        const employee = typeof e === 'string'
          ? { name: clean(e, 80), department: '' }
          : { name: clean(e?.name, 80), department: clean(e?.department, 40), cciId: clean(e?.cciId, 30).replace(/^CCI/i, '') };
        if (employee.department && !store.DEPARTMENTS.includes(employee.department)) employee.department = '';
        if (employee.cciId && !/^\d{1,20}$/.test(employee.cciId)) employee.cciId = '';
        return employee;
      })
      .filter(employee => {
        const nameKey = employee.name.toLowerCase();
        if (!employee.name || isStock(employee.name) || seenEmployeeNames.has(nameKey)) return false;
        seenEmployeeNames.add(nameKey);
        if (employee.cciId && seenCciIds.has(employee.cciId)) delete employee.cciId;
        if (employee.cciId) seenCciIds.add(employee.cciId);
        return true;
      });
  }
  if (Array.isArray(snap.dellCases)) {
    store.db.dellCases = [];
    for (const raw of snap.dellCases) {
      const validated = validateDellCase(raw);
      if (validated.error || store.db.dellCases.some(row => row.caseId.toLowerCase() === validated.value.caseId.toLowerCase())) continue;
      store.db.dellCases.push({ id: Number(raw.id) || store.nextId(), ...validated.value, updatedAt: raw.updatedAt || new Date().toISOString() });
    }
  }
  if (Array.isArray(snap.quickLinks)) {
    store.db.quickLinks = snap.quickLinks.filter(row => row && row.name && row.url && row.purpose).map(row => {
      let url;
      try { url = new URL(String(row.url)); } catch { return null; }
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      return { id: Number(row.id) || store.nextId(), name: clean(row.name, 100), url: url.toString(), purpose: clean(row.purpose, 300), createdBy: clean(row.createdBy, 80) || 'Imported backup', createdAt: row.createdAt || new Date().toISOString() };
    }).filter(Boolean);
  }
  if (Array.isArray(snap.deletedRecords)) {
    const safeDeleted = [];
    for (const raw of snap.deletedRecords.slice(0, 10000)) {
      if (!raw || !['asset', 'employee', 'consumable', 'deskPeripheral', 'dellCase', 'quickLink'].includes(raw.type) || !raw.record || typeof raw.record !== 'object') continue;
      let record;
      if (raw.type === 'asset') {
        const validated = validateAsset(raw.record, { requireDates: false });
        if (!validated.ok) continue;
        record = { id: Number(raw.record.id) || store.nextId(), ...validated.value };
        if (Array.isArray(raw.record.history)) record.history = raw.record.history.map(normalizeStockHistory);
        if (Array.isArray(raw.record.comments)) record.comments = raw.record.comments;
      } else {
        if (raw.type === 'consumable') {
          const validated = validateConsumable(raw.record);
          if (!validated.ok) continue;
          record = { id: Number(raw.record.id) || store.nextId(), ...validated.value, updatedAt: raw.record.updatedAt || new Date().toISOString() };
        } else if (raw.type === 'deskPeripheral') {
          const validated = validateDeskPeripheral(raw.record);
          if (validated.error) continue;
          record = { id: Number(raw.record.id) || store.nextId(), ...validated.value };
        } else if (raw.type === 'dellCase') {
          const validated = validateDellCase(raw.record);
          if (validated.error) continue;
          record = { id: Number(raw.record.id) || store.nextId(), ...validated.value, ...(Array.isArray(raw.record.comments) ? { comments: raw.record.comments } : {}), updatedAt: raw.record.updatedAt || new Date().toISOString() };
        } else if (raw.type === 'quickLink') {
          const name = clean(raw.record.name, 100);
          const purpose = clean(raw.record.purpose, 300);
          let url;
          try { const parsed = new URL(String(raw.record.url || '')); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid'); url = parsed.toString(); } catch { continue; }
          if (!name) continue;
          record = { id: Number(raw.record.id) || store.nextId(), name, url, purpose, createdBy: clean(raw.record.createdBy, 80) || 'Imported backup', createdAt: raw.record.createdAt || new Date().toISOString() };
        } else {
        const name = clean(raw.record.name, 80);
        if (!name) continue;
        record = { ...raw.record, name, department: clean(raw.record.department, 80), cciId: clean(raw.record.cciId, 32) };
        }
      }
      safeDeleted.push({ id: Number(raw.id) > 0 ? Number(raw.id) : store.nextId(), type: raw.type, record, deletedAt: clean(raw.deletedAt, 40) || new Date().toISOString(), deletedBy: clean(raw.deletedBy, 100) || 'Imported backup' });
    }
    store.db.deletedRecords = safeDeleted;
  }
  if (Array.isArray(snap.logs)) store.db.logs = snap.logs.slice(0, 200).map(row => ({ ...row, action: typeof row?.action === 'string' ? row.action.replace(/\bUnassigned\b/gi, STOCK) : row?.action }));
  if (Array.isArray(snap.signInEvents)) {
    store.db.signInEvents = snap.signInEvents.slice(0, 5000)
      .filter(row => row && (row.action === 'User logged in' || row.action === 'User logged out' || /^Sign-in failed \(attempt \d+\)$/.test(row.action) || /^Login locked after \d+ failed attempts$/.test(row.action)))
      .map(row => ({ timestamp: clean(row.timestamp, 40), user: clean(row.user, 254), action: clean(row.action, 80) }));
  } else if (Array.isArray(snap.logs)) {
    store.db.signInEvents = snap.logs.filter(row => row && (row.action === 'User logged in' || row.action === 'User logged out' || /^Sign-in failed \(attempt \d+\)$/.test(row.action) || /^Login locked after \d+ failed attempts$/.test(row.action))).slice(0, 5000);
  }
  // Keep the id sequence ahead of any restored id so new records never collide.
  const maxAssetId = cleanAssets.reduce((m, a) => Math.max(m, a.id), 0);
  const maxConsId = (store.db.consumables || []).reduce((m, c) => Math.max(m, Number(c.id) || 0), 0);
  const maxDeskId = (store.db.deskPeripherals || []).reduce((m, row) => Math.max(m, Number(row.id) || 0), 0);
  const maxFormerId = (store.db.formerEmployees || []).reduce((m, row) => Math.max(m, Number(row.id) || 0), 0);
  const maxCaseId = (store.db.dellCases || []).reduce((m, row) => Math.max(m, Number(row.id) || 0), 0);
  const maxLinkId = (store.db.quickLinks || []).reduce((m, row) => Math.max(m, Number(row.id) || 0), 0);
  const maxDeletedId = (store.db.deletedRecords || []).reduce((m, row) => Math.max(m, Number(row.id) || 0, Number(row.record?.id) || 0), 0);
  store.db.seq = Math.max(Number(snap.seq) || 0, maxAssetId, maxConsId, maxDeskId, maxFormerId, maxCaseId, maxLinkId, maxDeletedId, store.db.seq || 1000);
  store.addLog(req.user.username, `Restored data snapshot: ${cleanAssets.length} asset(s)` + (skipped ? `, ${skipped} skipped` : ''));
  store.persist();
  res.json({ ok: true, restored: cleanAssets.length, skipped });
});

// ---------------------------------------------------------------- Start
app.use((err, req, res, next) => {
  // A rejected CORS origin is a policy denial, not an application crash. Keep
  // the response explicit without writing a full middleware stack trace to the
  // production logs on every browser preflight/request.
  if (err?.message === 'This website origin is not allowed to access the AssetFlow API.') {
    return res.status(403).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

store.init().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`AssetFlow API listening on port ${PORT}`));
}).catch(error => {
  console.error('Could not start AssetFlow because the local database is unavailable.');
  console.error(error.message);
  process.exitCode = 1;
});
