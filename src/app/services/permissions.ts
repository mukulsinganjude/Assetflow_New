import { Role } from '../models/models';

export interface PermissionAction { key: string; label: string; }
export interface PermissionSection { key: string; title: string; actions: PermissionAction[]; }

export const PERMISSION_SECTIONS: PermissionSection[] = [
  { key: 'dashboard', title: 'Dashboard', actions: [{ key: 'view', label: 'View' }] },
  { key: 'assets', title: 'Asset Entry / Inventory', actions: [{ key: 'view', label: 'View' }, { key: 'add', label: 'Add' }, { key: 'edit', label: 'Edit / status' }, { key: 'assign', label: 'Check in / out' }, { key: 'delete', label: 'Delete' }, { key: 'import', label: 'Import' }, { key: 'export', label: 'Export' }, { key: 'comment', label: 'Comments' }] },
  { key: 'employeeDirectory', title: 'Manage Employees', actions: [{ key: 'view', label: 'View' }, { key: 'add', label: 'Add' }, { key: 'edit', label: 'Edit' }, { key: 'delete', label: 'Delete' }, { key: 'import', label: 'Import' }, { key: 'export', label: 'Export' }] },
  { key: 'employees', title: 'Employees', actions: [{ key: 'view', label: 'View' }, { key: 'comment', label: 'Add / edit comments' }] },
  { key: 'deskSetup', title: 'Desk Setup', actions: [{ key: 'view', label: 'View' }, { key: 'add', label: 'Add' }, { key: 'edit', label: 'Edit' }, { key: 'delete', label: 'Delete' }, { key: 'import', label: 'Import' }, { key: 'export', label: 'Export' }] },
  { key: 'consumables', title: 'Consumables', actions: [{ key: 'view', label: 'View' }, { key: 'add', label: 'Add' }, { key: 'edit', label: 'Edit' }, { key: 'adjust', label: 'Adjust stock' }, { key: 'delete', label: 'Delete' }, { key: 'import', label: 'Import' }, { key: 'export', label: 'Export' }] },
  { key: 'dropdowns', title: 'Dropdown Data', actions: [{ key: 'view', label: 'View' }, { key: 'manage', label: 'Manage' }] },
  { key: 'offboarding', title: 'Offboarding Returns', actions: [{ key: 'view', label: 'View' }, { key: 'start', label: 'Start checklist' }, { key: 'return', label: 'Record returns' }] },
  { key: 'formerEmployees', title: 'Former Employees', actions: [{ key: 'view', label: 'View' }, { key: 'archive', label: 'Archive employee' }, { key: 'export', label: 'Export' }] },
  { key: 'dellCases', title: 'Dell Cases', actions: [{ key: 'view', label: 'View' }, { key: 'add', label: 'Create' }, { key: 'edit', label: 'Edit' }, { key: 'delete', label: 'Delete' }, { key: 'comment', label: 'Comments' }, { key: 'import', label: 'Import' }, { key: 'export', label: 'Export' }] },
  { key: 'warranty', title: 'Warranty & Forecast', actions: [{ key: 'view', label: 'View' }, { key: 'edit', label: 'Update dates' }, { key: 'import', label: 'Import' }, { key: 'export', label: 'Export' }] },
  { key: 'links', title: 'Links', actions: [{ key: 'view', label: 'View' }, { key: 'add', label: 'Add' }, { key: 'delete', label: 'Delete' }, { key: 'import', label: 'Import' }, { key: 'export', label: 'Export' }] },
  { key: 'activity', title: 'Activity Trail', actions: [{ key: 'view', label: 'View' }, { key: 'export', label: 'Export' }, { key: 'clear', label: 'Clear logs' }] },
  { key: 'users', title: 'System Users Management', actions: [{ key: 'manage', label: 'Manage users, roles, and titles' }] },
  { key: 'backup', title: 'Backup & Restore', actions: [{ key: 'manage', label: 'Download / restore backups' }] }
];

export const ALL_PERMISSION_KEYS = PERMISSION_SECTIONS.flatMap(section => section.actions.map(action => `${section.key}.${action.key}`));
const rolePermissions: Record<Role, string[]> = {
  admin: ALL_PERMISSION_KEYS,
  entry: ['dashboard.view', 'assets.view', 'assets.add', 'assets.edit', 'assets.assign', 'assets.import', 'assets.export', 'assets.comment', 'employees.view', 'employees.comment', 'offboarding.view', 'offboarding.start', 'offboarding.return', 'formerEmployees.view', 'formerEmployees.archive', 'formerEmployees.export', 'dellCases.view', 'dellCases.add', 'dellCases.edit', 'dellCases.delete', 'dellCases.import', 'dellCases.export', 'dellCases.comment', 'warranty.view', 'warranty.edit', 'warranty.import', 'warranty.export', 'links.view', 'links.add', 'links.delete', 'links.import', 'links.export', 'deskSetup.view', 'deskSetup.add', 'deskSetup.edit', 'deskSetup.delete', 'deskSetup.import', 'deskSetup.export', 'activity.view', 'activity.export'],
  viewer: ['dashboard.view', 'employees.view', 'formerEmployees.view', 'formerEmployees.export', 'warranty.view', 'warranty.export', 'links.view', 'activity.view', 'activity.export']
};

export function roleDefaultPermissions(role: Role): string[] { return rolePermissions[role] || []; }
