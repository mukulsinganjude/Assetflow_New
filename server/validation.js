'use strict';
/**
 * Server-side validation + sanitization. This is the real trust boundary —
 * the client validates too for UX, but every write is re-checked here.
 */
const store = require('./db');
const { DEPARTMENTS, STATUSES, STOCK_LABEL } = store;

/** Strip control chars, collapse whitespace, cap length. Neutralizes stored-XSS
 *  payloads at the source (the Angular client also escapes on render). */
function clean(value, maxLen = 120) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, '') // control chars
    .trim()
    .slice(0, maxLen);
}

/** Sanitize free-form text while preserving paragraph breaks for textareas. */
function cleanMultiline(value, maxLen = 120) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\t/g, ' ')
    .trim()
    .slice(0, maxLen);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  // Reject calendar rollovers (e.g. 2024-02-31 → March). new Date() silently
  // normalizes those, so verify the parsed parts match the input exactly.
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Validate + normalize an incoming asset payload.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function validateAsset(input, { requireDates = true } = {}) {
  const name = clean(input.name);
  const category = clean(input.category, 40);
  let department = clean(input.department, 40);
  const serial = clean(input.serial, 60);
  const assignmentType = clean(input.assignmentType, 20) || 'Primary';
  const rawAssignee = clean(input.assignedTo, 80);
  const assignedTo = !rawAssignee || ['stock', 'unassigned'].includes(rawAssignee.toLowerCase()) ? STOCK_LABEL : rawAssignee;
  const status = clean(input.status, 40);
  const purchaseDate = clean(input.purchaseDate, 10);
  const warrantyDate = clean(input.warrantyDate, 10);

  department = normalizeAssetDepartment(department, status, assignedTo);

  if (!name) return { ok: false, error: 'Item name is required.' };
  if (!serial) return { ok: false, error: 'Serial number is required.' };
  if (!store.dropdownOptions.assetCategories.includes(category)) return { ok: false, error: `Invalid category "${category}".` };
  if (['stock', 'unassigned'].includes(department.toLowerCase())) department = STOCK_LABEL;
  if (department !== STOCK_LABEL && !DEPARTMENTS.includes(department)) return { ok: false, error: `Invalid department "${department}".` };
  if (!STATUSES.includes(status)) return { ok: false, error: `Invalid status "${status}".` };
  if (!['Primary', 'Temporary'].includes(assignmentType)) return { ok: false, error: `Invalid assignment type "${assignmentType}".` };

  if (requireDates || purchaseDate) {
    if (!isValidDate(purchaseDate)) return { ok: false, error: 'Purchase date must be a valid YYYY-MM-DD date.' };
  }
  if (requireDates || warrantyDate) {
    if (!isValidDate(warrantyDate)) return { ok: false, error: 'Warranty date must be a valid YYYY-MM-DD date.' };
  }
  if (isValidDate(purchaseDate) && isValidDate(warrantyDate) && warrantyDate < purchaseDate) {
    return { ok: false, error: 'Warranty date cannot be earlier than the purchase date.' };
  }

  return { ok: true, value: { name, category, department, serial, assignmentType, assignedTo, status, purchaseDate, warrantyDate } };
}

/** Keep unassigned storage/repair items out of department reporting. If an asset
 *  leaves that state without a department, use IT as its default department. */
function normalizeAssetDepartment(department, status, assignedTo) {
  const staff = String(assignedTo || '').trim();
  const stock = !staff || ['stock', 'unassigned'].includes(staff.toLowerCase());
  if (stock && (status === 'In Storage' || status === 'Under Repair')) return STOCK_LABEL;
  return department;
}

/**
 * Validate + normalize an incoming consumable (quantity-tracked stock) payload.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function validateConsumable(input) {
  const name = clean(input.name);
  const category = clean(input.category, 40) || 'Other';
  const unit = clean(input.unit, 20) || 'pcs';
  const location = clean(input.location, 80);
  const notes = clean(input.notes, 300);
  const quantity = Number(input.quantity);
  const reorderThreshold = Number(input.reorderThreshold);

  if (!name) return { ok: false, error: 'Item name is required.' };
  if (!store.dropdownOptions.consumableCategories.includes(category)) return { ok: false, error: `Invalid category "${category}".` };
  if (!store.dropdownOptions.consumableUnits.includes(unit)) return { ok: false, error: `Invalid unit "${unit}".` };
  if (input.quantity === null || input.quantity === undefined || String(input.quantity).trim() === '' || !Number.isInteger(quantity) || quantity < 0 || quantity > 1000000) return { ok: false, error: 'Quantity must be a whole number between 0 and 1,000,000.' };
  if (input.reorderThreshold === null || input.reorderThreshold === undefined || String(input.reorderThreshold).trim() === '' || !Number.isInteger(reorderThreshold) || reorderThreshold < 0 || reorderThreshold > 1000000) return { ok: false, error: 'Reorder threshold must be a whole number between 0 and 1,000,000.' };

  return { ok: true, value: { name, category, unit, location, notes, quantity, reorderThreshold } };
}

module.exports = { clean, cleanMultiline, isValidDate, normalizeAssetDepartment, validateAsset, validateConsumable };
