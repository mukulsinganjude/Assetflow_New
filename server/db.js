'use strict';
/**
 * AssetFlow state store backed by a local JSON database.
 *
 * The API keeps a synchronous in-memory view and serializes durable snapshots
 * to server/data.json.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_FILE = path.join(__dirname, 'data.json');
const ENV_FILE = path.join(__dirname, '..', '.env.local');
const STOCK_LABEL = 'Stock';
const MAX_SIGN_IN_EVENTS = 5000;
const isSignInEvent = action => action === 'User logged in' || action === 'User logged out' ||
  /^Sign-in failed \(attempt \d+\)$/.test(action) || /^Login locked after \d+ failed attempts$/.test(action);
const isStockValue = value => ['stock', 'unassigned'].includes(String(value || '').trim().toLowerCase());
const normalizeStockValue = value => isStockValue(value) ? STOCK_LABEL : String(value || '').trim();

// Load only the app's private server settings; shell values win.
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(ASSETFLOW_BOOTSTRAP_ADMIN_EMAIL|ASSETFLOW_BOOTSTRAP_ADMIN_PASSWORD|ASSETFLOW_BOOTSTRAP_ADMIN_NAME|JWT_SECRET)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

const CATALOG = {
  'Laptop': [
    'Dell Latitude 3530', 'Dell Latitude 3540', 'Dell Latitude 5450',
    'Dell Pro 14 PC14250', 'Dell Latitude 5430', 'Dell Latitude 5440',
    'Dell Latitude 5450 i5', 'Dell Latitude 5420', 'MacBook Pro M3 Max', 'MacBook Air 15"'
  ],
  'Monitor': ['Dell UltraSharp 27" 4K', 'Dell 24 Monitor P2422H', 'Apple Studio Display 5K', 'LG 34" Ultrawide'],
  'Mouse': ['Logitech MX Master 3S', 'Dell Laser Mouse', 'Logitech Mouse', 'Magic Mouse 2'],
  'Docking Station': ['Dell Thunderbolt Dock WD22TB4', 'Dell USB-C Dock WD19S', 'CalDigit TS4 Plus'],
  'Headset': ['Epos Impact 460T', 'Jabra EVOLVE 20', 'Jabra Evolve2 65', 'Sony WH-1000XM5']
};
const CATEGORIES = ['Laptop', 'Monitor', 'Mouse', 'Docking Station', 'Headset'];
const DEPARTMENTS = ['IT', 'BPS', 'HR', 'Finance', 'Admin'];
const STATUSES = ['In Use', 'In Storage', 'Under Repair'];

const DEFAULT_ASSETS = [
  { id: 1, name: 'MacBook Pro M3 Max', category: 'Laptop', department: 'IT', serial: 'C02G200VMD6R', assignedTo: 'Sarah Jenkins', status: 'In Use', purchaseDate: '2024-01-15', warrantyDate: '2027-01-15' },
  { id: 2, name: 'Dell Latitude 3540', category: 'Laptop', department: 'BPS', serial: 'DL-882310-X', assignedTo: 'Alex Rivera', status: 'In Use', purchaseDate: '2023-05-10', warrantyDate: '2026-05-10' },
  { id: 3, name: 'Dell UltraSharp 27" 4K', category: 'Monitor', department: 'IT', serial: 'MON-DL-4921', assignedTo: 'Sarah Jenkins', status: 'In Use', purchaseDate: '2023-08-20', warrantyDate: '2025-08-20' },
  { id: 4, name: 'Logitech MX Master 3S', category: 'Mouse', department: 'BPS', serial: 'LOG-MSE-9921', assignedTo: 'Alex Rivera', status: 'In Use', purchaseDate: '2024-02-10', warrantyDate: '2025-02-10' },
  { id: 5, name: 'Jabra EVOLVE 20', category: 'Headset', department: 'IT', serial: 'JAB-HS-4481', assignedTo: 'Sarah Jenkins', status: 'In Use', purchaseDate: '2024-03-01', warrantyDate: '2026-03-01' },
  { id: 6, name: 'Dell Latitude 5450 i5', category: 'Laptop', department: 'Finance', serial: 'DL-5450-901', assignedTo: 'David Kim', status: 'In Use', purchaseDate: '2022-11-10', warrantyDate: '2025-11-10' },
  { id: 7, name: 'Epos Impact 460T', category: 'Headset', department: 'Finance', serial: 'EPOS-460-01', assignedTo: 'David Kim', status: 'In Use', purchaseDate: '2024-06-12', warrantyDate: '2026-06-12' }
];

// Quantity-tracked consumables (cables, adapters, etc.) — distinct from the
// serial-tracked assets above. Each row is a stock line with a reorder threshold.
const CONSUMABLE_CATEGORIES = ['Cables', 'Adapters', 'Peripherals', 'Storage', 'Power', 'Accessories', 'Other'];
const CONSUMABLE_UNITS = ['pcs', 'boxes', 'packs', 'sets', 'metres'];
const DEFAULT_DROPDOWN_OPTIONS = {
  assetCategories: [...CATEGORIES], assetModels: JSON.parse(JSON.stringify(CATALOG)),
  deskCategories: ['Monitor', 'Docking Station'],
  consumableCategories: [...CONSUMABLE_CATEGORIES], consumableUnits: [...CONSUMABLE_UNITS]
};
function normalizeDropdownOptions(value) {
  const source = value && typeof value === 'object' ? value : {};
  const list = (input, fallback) => {
    const items = Array.isArray(input) ? input : fallback;
    return [...new Map(items.map(item => String(item || '').trim()).filter(Boolean).map(item => [item.toLowerCase(), item])).values()];
  };
  const assetCategories = list(source.assetCategories, DEFAULT_DROPDOWN_OPTIONS.assetCategories);
  const rawModels = source.assetModels && typeof source.assetModels === 'object' ? source.assetModels : DEFAULT_DROPDOWN_OPTIONS.assetModels;
  const assetModels = Object.fromEntries(assetCategories.map(category => [category, list(rawModels[category], [])]));
  return {
    assetCategories, assetModels,
    deskCategories: ['Monitor', 'Docking Station'],
    consumableCategories: list(source.consumableCategories, DEFAULT_DROPDOWN_OPTIONS.consumableCategories),
    consumableUnits: list(source.consumableUnits, DEFAULT_DROPDOWN_OPTIONS.consumableUnits)
  };
}
function validateDropdownOptions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Dropdown data must be an object.' };
  const fields = ['assetCategories', 'consumableCategories', 'consumableUnits'];
  for (const field of fields) {
    if (!Array.isArray(input[field]) || input[field].length > 100) return { error: `Provide up to 100 ${field.replace(/[A-Z]/g, x => ` ${x.toLowerCase()}`)}.` };
    if (input[field].some(x => typeof x !== 'string' || !x.trim() || x.trim().length > 60)) return { error: `Each ${field} entry must be 1–60 characters.` };
  }
  if (!input.assetModels || typeof input.assetModels !== 'object' || Array.isArray(input.assetModels)) return { error: 'Asset models must be grouped by category.' };
  for (const category of input.assetCategories) {
    const models = input.assetModels[category];
    if (!Array.isArray(models) || models.length > 200 || models.some(x => typeof x !== 'string' || !x.trim() || x.trim().length > 100)) return { error: `Provide up to 200 valid models for ${category}.` };
  }
  const value = normalizeDropdownOptions(input);
  if (!value.assetCategories.includes('Monitor') || !value.assetCategories.includes('Docking Station')) return { error: 'Monitor and Docking Station categories are required for Desk Setup.' };
  for (const field of fields) if (!value[field].length) return { error: `${field} must have at least one option.` };
  return { value };
}

const DEFAULT_CONSUMABLES = [
  { id: 1, name: 'USB-C to HDMI Adapter', category: 'Adapters', quantity: 24, reorderThreshold: 10, unit: 'pcs', location: 'IT Store Room A', notes: '', updatedAt: new Date().toISOString() },
  { id: 2, name: 'USB-C Charging Cable 2m', category: 'Cables', quantity: 8, reorderThreshold: 15, unit: 'pcs', location: 'IT Store Room A', notes: 'Running low', updatedAt: new Date().toISOString() },
  { id: 3, name: 'Wireless Keyboard', category: 'Peripherals', quantity: 12, reorderThreshold: 5, unit: 'pcs', location: 'IT Store Room B', notes: '', updatedAt: new Date().toISOString() },
  { id: 4, name: 'HDMI Cable 1.5m', category: 'Cables', quantity: 30, reorderThreshold: 10, unit: 'pcs', location: 'IT Store Room A', notes: '', updatedAt: new Date().toISOString() },
  { id: 5, name: '65W USB-C Power Adapter', category: 'Power', quantity: 4, reorderThreshold: 8, unit: 'pcs', location: 'IT Store Room B', notes: 'Reorder soon', updatedAt: new Date().toISOString() }
];

function bootstrapUsers() {
  const email = String(process.env.ASSETFLOW_BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ASSETFLOW_BOOTSTRAP_ADMIN_PASSWORD || '').trim();
  if (!email && !password) return [];
  if (!/^[^\s@]+@ccrn\.com$/.test(email) || password.length < 12 || password.length > 72) {
    throw new Error('Set ASSETFLOW_BOOTSTRAP_ADMIN_EMAIL to a valid @ccrn.com address and ASSETFLOW_BOOTSTRAP_ADMIN_PASSWORD to a unique password of 12–72 characters.');
  }
  return [{
    username: email,
    email,
    displayName: String(process.env.ASSETFLOW_BOOTSTRAP_ADMIN_NAME || 'Administrator').trim().slice(0, 60) || 'Administrator',
    passHash: bcrypt.hashSync(password, 12),
    role: 'admin'
  }];
}

function removeLegacyDemoAccounts(state) {
  // Older snapshots may predate unique first-run setup. Only
  // remove accounts whose stored hash still matches a publicly disclosed seed
  // password; users who already changed their password are left untouched.
  const exposedPasswords = { admin: 'Admin@2026', entry: 'entry123', viewer: 'viewer123' };
  const legacy = state.users.filter(user => exposedPasswords[user.username] && bcrypt.compareSync(exposedPasswords[user.username], user.passHash || ''));
  if (!legacy.length) return;

  const legacyAdmin = legacy.some(user => user.role === 'admin');
  const replacementAdmin = legacyAdmin ? bootstrapUsers() : [];
  if (legacyAdmin && replacementAdmin.length === 0) {
    throw new Error('A legacy administrator still uses a publicly known password. Set a unique ASSETFLOW_BOOTSTRAP_ADMIN_EMAIL and ASSETFLOW_BOOTSTRAP_ADMIN_PASSWORD in .env.local to rotate it before starting.');
  }

  const removed = new Set(legacy);
  state.users = state.users.filter(user => !removed.has(user));
  if (legacyAdmin) state.users.push(replacementAdmin[0]);
  console.warn(`[security] Removed ${legacy.length} unchanged legacy demo account(s)${legacyAdmin ? ' and rotated the administrator using bootstrap settings' : ''}.`);
}

let db = null;
let writeQueue = Promise.resolve();
let latestWrite = Promise.resolve();
let pendingWrites = 0;

function seed() {
  const initialUsers = bootstrapUsers();
  if (initialUsers.length === 0) {
    throw new Error('No database exists yet. Set ASSETFLOW_BOOTSTRAP_ADMIN_EMAIL and ASSETFLOW_BOOTSTRAP_ADMIN_PASSWORD in .env.local to create the first administrator.');
  }
  return {
    assets: DEFAULT_ASSETS.map(a => ({
      ...a,
      assignedTo: normalizeStockValue(a.assignedTo) || STOCK_LABEL,
      department: normalizeStockValue(a.department) || STOCK_LABEL,
      assignmentType: 'Primary',
      history: [{
        ts: (a.purchaseDate ? new Date(a.purchaseDate + 'T09:00:00') : new Date()).toISOString(),
        user: 'System',
        action: `Registered · ${a.status} · assigned to ${normalizeStockValue(a.assignedTo) || STOCK_LABEL}`
      }]
    })),
    deletedRecords: [],
    users: initialUsers,
    logs: [{ timestamp: new Date().toLocaleString(), user: 'System', action: 'Enterprise cluster telemetry initialized.' }],
    signInEvents: [],
    dropdownOptions: JSON.parse(JSON.stringify(DEFAULT_DROPDOWN_OPTIONS)),
    employeeComments: {},
    consumables: DEFAULT_CONSUMABLES.map(c => ({ ...c })),
    deskPeripherals: [],
    formerEmployees: [],
    offboardingChecklists: [],
    dellCases: [],
    quickLinks: [],
    employees: [],
    seq: 1000,
    changeSequence: 0,
    assetCommentHistoryV1: true
  };
}

/**
 * Normalize a stored desk-peripheral row into the current shape
 * `{ deskNo, category, model, serial }`. Legacy rows that bundled a monitor and
 * docking station together `{ monitorMake, monitorSerial, dockingMake, dockingSerial }`
 * are split into one row per populated item. Returns an array (0, 1, or 2 rows).
 */
function expandLegacyDeskRow(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const deskNo = String(raw.deskNo || '').trim();
  // Already in the current shape — pass through.
  if (raw.category || raw.model) {
    return [{ deskNo, category: String(raw.category || '').trim(), model: String(raw.model || '').trim(), serial: String(raw.serial || '').trim() }];
  }
  const rows = [];
  if (raw.monitorMake) rows.push({ deskNo, category: 'Monitor', model: String(raw.monitorMake).trim(), serial: String(raw.monitorSerial || '').trim() });
  if (raw.dockingMake) rows.push({ deskNo, category: 'Docking Station', model: String(raw.dockingMake).trim(), serial: String(raw.dockingSerial || '').trim() });
  return rows;
}

function normalizeState(state) {
  // Migrate older data files/documents that predate later app features.
  if (!state.employeeComments || typeof state.employeeComments !== 'object') state.employeeComments = {};
  state.dropdownOptions = normalizeDropdownOptions(state.dropdownOptions);
  if (!Array.isArray(state.consumables)) state.consumables = [];
  if (!Array.isArray(state.deskPeripherals)) state.deskPeripherals = [];
  // Migrate desk rows to the per-item shape and drop any that are incomplete.
  {
    const expanded = [];
    const usedIds = new Set();
    const freshId = () => { state.seq = (Number(state.seq) || 1000) + 1; return state.seq; };
    for (const raw of state.deskPeripherals) {
      const rows = expandLegacyDeskRow(raw);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.deskNo || !r.category || !r.model || !r.serial) continue;
        // Reuse the original id for the first split row; mint new ids for the rest or on collision.
        let id = i === 0 ? Number(raw && raw.id) : NaN;
        if (!Number.isFinite(id) || usedIds.has(id)) id = freshId();
        usedIds.add(id);
        expanded.push({ id, ...r });
      }
    }
    state.deskPeripherals = expanded;
  }
  if (!Array.isArray(state.formerEmployees)) state.formerEmployees = [];
  if (!Array.isArray(state.offboardingChecklists)) state.offboardingChecklists = [];
  if (!Array.isArray(state.dellCases)) state.dellCases = [];
  if (!Array.isArray(state.quickLinks)) state.quickLinks = [];
  // Stock-take audit sessions were removed; discard the legacy payload when
  // loading a local snapshot or importing an older backup.
  delete state.audits;
  if (!Array.isArray(state.logs)) state.logs = [];
  if (!Array.isArray(state.signInEvents)) state.signInEvents = state.logs.filter(row => isSignInEvent(row?.action));
  state.signInEvents = state.signInEvents.filter(row => row && isSignInEvent(row.action)).slice(0, MAX_SIGN_IN_EVENTS);
  if (!Number.isSafeInteger(state.changeSequence) || state.changeSequence < 0) state.changeSequence = state.logs.length;
  if (!Array.isArray(state.users)) state.users = [];
  removeLegacyDemoAccounts(state);
  if (!Array.isArray(state.assets)) state.assets = [];
  if (!Array.isArray(state.deletedRecords)) state.deletedRecords = [];
  if (state.deletedRecords.length) {
    const maxDeletedId = state.deletedRecords.reduce((max, row) => Math.max(max, Number(row?.id) || 0), 0);
    state.seq = Math.max(Number(state.seq) || 1000, maxDeletedId);
  }
  state.assets.forEach(asset => {
    if (!asset || typeof asset !== 'object') return;
    if (!['Primary', 'Temporary'].includes(asset.assignmentType)) asset.assignmentType = 'Primary';
    asset.assignedTo = normalizeStockValue(asset.assignedTo) || STOCK_LABEL;
    asset.department = normalizeStockValue(asset.department);
    if ((asset.status === 'In Storage' || asset.status === 'Under Repair') && isStockValue(asset.assignedTo)) asset.department = STOCK_LABEL;
    if (Array.isArray(asset.history)) asset.history.forEach(entry => {
      if (!entry || typeof entry !== 'object') return;
      if (isStockValue(entry.from)) entry.from = STOCK_LABEL;
      if (isStockValue(entry.to)) entry.to = STOCK_LABEL;
      if (typeof entry.action === 'string') entry.action = entry.action.replace(/\bUnassigned\b/gi, STOCK_LABEL);
    });
  });
  const migrateFormerAsset = asset => {
    if (!asset || typeof asset !== 'object') return;
    asset.assignedTo = normalizeStockValue(asset.assignedTo) || STOCK_LABEL;
    asset.department = normalizeStockValue(asset.department);
    if (Array.isArray(asset.history)) asset.history.forEach(entry => {
      if (!entry || typeof entry !== 'object') return;
      if (isStockValue(entry.from)) entry.from = STOCK_LABEL;
      if (isStockValue(entry.to)) entry.to = STOCK_LABEL;
      if (typeof entry.action === 'string') entry.action = entry.action.replace(/\bUnassigned\b/gi, STOCK_LABEL);
    });
  };
  state.formerEmployees.forEach(row => Array.isArray(row?.assets) && row.assets.forEach(migrateFormerAsset));
  state.logs.forEach(row => { if (typeof row?.action === 'string') row.action = row.action.replace(/\bUnassigned\b/gi, STOCK_LABEL); });
  // Backfill comment activity that predates the unified per-asset timeline.
  // The state marker makes this a one-time migration; comment content stays in
  // the existing comment records and timeline entries retain their original dates.
  if (state.assetCommentHistoryV1 !== true) {
    for (const asset of state.assets) {
      if (!asset || !Array.isArray(asset.comments)) continue;
      if (!Array.isArray(asset.history)) asset.history = [];
      for (const comment of asset.comments) {
        if (!comment || !String(comment.text || '').trim()) continue;
        asset.history.push({
          ts: comment.ts || new Date().toISOString(),
          user: comment.user || 'System',
          action: `Comment added: ${comment.text}`
        });
        if (comment.editedTs) asset.history.push({
          ts: comment.editedTs,
          user: comment.user || 'System',
          action: `Comment edited: ${comment.text}`
        });
      }
      asset.history.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      if (asset.history.length > 100) asset.history.length = 100;
    }
    state.assetCommentHistoryV1 = true;
  }
  if (!Number.isFinite(Number(state.seq))) state.seq = 1000;

  // Employee roster — a first-class table of people assets can be assigned to.
  // Each entry is { name, department }. On first migration (or whenever the
  // roster is empty), seed it from the names already present on assets so the
  // dropdown isn't blank for existing data.
  if (!Array.isArray(state.employees)) state.employees = [];
  state.employees = state.employees
    .map(e => (typeof e === 'string'
      ? { name: e.trim(), department: '' }
      : { name: String(e?.name || '').trim(), department: String(e?.department || '').trim(), ...(String(e?.cciId || '').trim() ? { cciId: String(e.cciId).trim() } : {}) }))
    .map(e => ({ ...e, department: normalizeStockValue(e.department) }))
    .filter(e => e.name && !isStockValue(e.name));
  if (state.employees.length === 0 && Array.isArray(state.assets)) {
    const seen = new Set();
    for (const a of state.assets) {
      const name = String(a?.assignedTo || '').trim();
      const key = name.toLowerCase();
      if (name && !isStockValue(name) && !seen.has(key)) {
        seen.add(key);
        state.employees.push({ name, department: String(a?.department || '').trim() });
      }
    }
  }
  return state;
}

function loadLocalState() {
  if (!fs.existsSync(DATA_FILE)) return seed();
  let localState;
  try {
    localState = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!localState || typeof localState !== 'object' || Array.isArray(localState)) throw new Error('Expected a JSON object.');
    delete localState.pendingAdminCredentialSync;
  } catch (error) {
    const backup = DATA_FILE.replace(/\.json$/, '') + `.corrupt-${Date.now()}.json`;
    try { fs.copyFileSync(DATA_FILE, backup); } catch (_) { /* preserve startup, keep backup if possible */ }
    throw new Error(`Local database server/data.json could not be read (${error.message}); a recovery copy was attempted at ${path.basename(backup)}. Refusing to seed over it.`);
  }
  // Policy/setup errors during normalization must not label a healthy data file
  // as corrupt or create a misleading recovery copy.
  return normalizeState(localState);
}

async function init() {
  if (db) return db;
  const exists = fs.existsSync(DATA_FILE);
  db = exists ? loadLocalState() : seed();
  if (!exists) await persist();
  console.log(`${exists ? 'Loaded' : 'Initialized'} local database (${db.assets.length} assets, ${db.users.length} users) at server/data.json.`);
  return db;
}

function load() {
  if (!db) throw new Error('The AssetFlow datastore has not been initialized.');
  return db;
}

function persist() {
  if (!db) return Promise.reject(new Error('The AssetFlow datastore has not been initialized.'));
  // Serialize snapshots so concurrent API requests cannot overwrite a newer
  // state with an older one. API responses wait for durable storage to finish.
  const snapshot = JSON.parse(JSON.stringify(db));
  pendingWrites++;
  const operation = writeQueue.catch(() => {}).then(async () => {
    const temporaryFile = `${DATA_FILE}.tmp`;
    try {
      await fs.promises.writeFile(temporaryFile, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await fs.promises.rename(temporaryFile, DATA_FILE);
    } catch (error) {
      try { await fs.promises.unlink(temporaryFile); } catch (_) { /* no temporary file to clean up */ }
      throw error;
    }
  });
  writeQueue = operation.then(
    () => { pendingWrites--; },
    error => { pendingWrites--; console.error('Local database write failed:', error.message); }
  );
  latestWrite = operation;
  // Attach a handler immediately because existing routes intentionally invoke
  // persist without awaiting; the response barrier below reports failures.
  operation.catch(() => {});
  return operation;
}

function flush() { return latestWrite; }
function hasPendingWrites() { return pendingWrites > 0; }

function nextId() {
  db.seq = (db.seq || 1000) + 1;
  return db.seq;
}

function addLog(user, action) {
  // Store one unambiguous timestamp format; the UI formats it for each user's locale.
  db.changeSequence = (Number(db.changeSequence) || 0) + 1;
  const entry = { timestamp: new Date().toISOString(), user: user || 'System', action };
  db.logs.unshift(entry);
  if (db.logs.length > 200) db.logs.length = 200;
  if (isSignInEvent(action)) {
    if (!Array.isArray(db.signInEvents)) db.signInEvents = [];
    db.signInEvents.unshift(entry);
    if (db.signInEvents.length > MAX_SIGN_IN_EVENTS) db.signInEvents.length = MAX_SIGN_IN_EVENTS;
  }
}

/**
 * Append a lifecycle entry to an asset's embedded history timeline (newest first,
 * capped at 100). History lives on the asset object itself so it travels with the
 * asset through GET /api/assets — no separate collection or join needed.
 */
function pushHistory(asset, user, action, change = {}) {
  if (!asset || !action) return;
  if (!Array.isArray(asset.history)) asset.history = [];
  asset.history.unshift({ ts: new Date().toISOString(), user: user || 'System', action, ...change });
  if (asset.history.length > 100) asset.history.length = 100;
}

/**
 * Ensure a person exists in the employee roster. Called whenever an asset is
 * assigned so the roster stays in sync without a separate admin step. Matching
 * is case-insensitive; a real (non-"Stock") name is required. Fills in the
 * department if the existing entry has none. Returns true if the roster changed.
 */
function upsertEmployee(name, department = '') {
  const clean = String(name || '').trim();
  if (!clean || isStockValue(clean)) return false;
  if (!Array.isArray(db.employees)) db.employees = [];
  const existing = db.employees.find(e => e.name.toLowerCase() === clean.toLowerCase());
  if (existing) {
    if (!existing.department && department) { existing.department = String(department).trim(); return true; }
    return false;
  }
  db.employees.push({ name: clean, department: String(department || '').trim() });
  return true;
}

module.exports = {
  init, load, persist, flush, hasPendingWrites, nextId, addLog, pushHistory, upsertEmployee,
  expandLegacyDeskRow,
  normalizeDropdownOptions, validateDropdownOptions, DEFAULT_DROPDOWN_OPTIONS,
  get dropdownOptions() { return load().dropdownOptions; },
  CATALOG, CATEGORIES, DEPARTMENTS, STATUSES, STOCK_LABEL,
  CONSUMABLE_CATEGORIES, CONSUMABLE_UNITS,
  get db() { return load(); }
};
