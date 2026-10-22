import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { AuthService } from '../../services/auth.service';
import { UiService } from '../../services/ui.service';
import { CustomSelectComponent } from '../shared/custom-select.component';
import { SelectOption, User } from '../../models/models';
import { ALL_PERMISSION_KEYS, PERMISSION_SECTIONS, PermissionAction, roleDefaultPermissions } from '../../services/permissions';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule, CustomSelectComponent],
  templateUrl: './users.component.html'
})
export class UsersComponent implements OnInit {
  readonly permissionSections = PERMISSION_SECTIONS;
  readonly allPermissionKeys = ALL_PERMISSION_KEYS;
  readonly permissionColumns: PermissionAction[] = [
    { key: 'view', label: 'View' }, { key: 'add', label: 'Add' }, { key: 'edit', label: 'Edit' },
    { key: 'assign', label: 'Assign' }, { key: 'return', label: 'Return' }, { key: 'start', label: 'Start' },
    { key: 'delete', label: 'Delete' }, { key: 'adjust', label: 'Adjust' }, { key: 'comment', label: 'Comment' },
    { key: 'archive', label: 'Archive' }, { key: 'import', label: 'Import' }, { key: 'export', label: 'Export' },
    { key: 'clear', label: 'Clear' }, { key: 'manage', label: 'Manage' }
  ];
  roleOptions: SelectOption[] = [
    { value: 'viewer', label: 'Read-Only (Viewer)' },
    { value: 'entry', label: 'Data Entry' },
    { value: 'admin', label: 'Admin (Full Access)' }
  ];
  readonly signInEventOptions: SelectOption[] = [
    { value: 'all', label: 'All events' }, { value: 'in', label: 'Signed in' },
    { value: 'out', label: 'Signed out' }, { value: 'failed', label: 'Failed / blocked' }
  ];

  modalOpen = signal(false);
  newDisplayName = '';
  newEmail = '';
  newPassword = '';
  newRole = signal<string>('viewer');
  newTitle = '';

  // edit modal
  editOpen = signal(false);
  editUsername = '';
  editDisplayName = '';
  editEmail = '';
  editRole = signal<string>('viewer');
  editTitle = '';
  editPassword = '';
  editSaving = signal(false);

  accessOpen = signal(false);
  signInHistoryOpen = signal(false);
  signInUserFilter = signal('');
  signInFromDate = signal('');
  signInToDate = signal('');
  signInEventFilter = signal('all');
  signInPage = signal(1);
  signInPageSize = signal(10);
  selectedAccessUser = signal('');
  selectedPermissions = signal<string[]>([]);
  savingPermissions = signal(false);

  // backup / restore
  backupBusy = signal(false);
  restoreBusy = signal(false);

  // ---- Sorting ----
  sortField = signal<string>('displayName');
  sortAsc = signal(true);
  sortedUsers = computed<User[]>(() => {
    const field = this.sortField();
    const asc = this.sortAsc();
    const val = (u: User) =>
      field === 'role' ? (u.role || '').toLowerCase()
        : field === 'title' ? (u.title || '').toLowerCase()
          : (u.displayName || u.username || '').toLowerCase();
    return [...this.data.users()].sort((a, b) =>
      asc ? val(a).localeCompare(val(b)) : val(b).localeCompare(val(a)));
  });

  /** Authentication events have their own longer retention and filters. */
  signInHistory = computed(() => {
    const userQuery = this.signInUserFilter().trim().toLowerCase();
    const fromDate = this.signInFromDate();
    const toDate = this.signInToDate();
    const eventFilter = this.signInEventFilter();
    return this.data.signInEvents().filter(event => {
      const eventDate = this.localDateKey(event.timestamp);
      if (fromDate && (!eventDate || eventDate < fromDate)) return false;
      if (toDate && (!eventDate || eventDate > toDate)) return false;
      if (userQuery) {
        const profile = this.securityEventProfile(event.user);
        const searchable = [event.user, this.data.displayNameFor(event.user), profile?.email, profile?.displayName]
          .filter(Boolean).join(' ').toLowerCase();
        if (!searchable.includes(userQuery)) return false;
      }
      if (eventFilter === 'in' && event.action !== 'User logged in') return false;
      if (eventFilter === 'out' && event.action !== 'User logged out') return false;
      if (eventFilter === 'failed' && !event.action.startsWith('Sign-in failed') && !event.action.startsWith('Login locked')) return false;
      return true;
    });
  });
  accessUserOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'Choose a user...' },
    ...this.sortedUsers().map(user => ({
      value: user.username,
      label: `${user.displayName || user.username} · ${user.email || user.username} · ${user.role}`
    }))
  ]);
  signInHistoryPages = computed(() => Math.max(1, Math.ceil(this.signInHistory().length / this.signInPageSize())));
  signInHistoryCurrentPage = computed(() => Math.min(this.signInPage(), this.signInHistoryPages()));
  signInHistoryPageRows = computed(() => {
    const size = this.signInPageSize();
    const start = (this.signInHistoryCurrentPage() - 1) * size;
    return this.signInHistory().slice(start, start + size);
  });
  signInHistoryShowingStart = computed(() => this.signInHistory().length ? (this.signInHistoryCurrentPage() - 1) * this.signInPageSize() + 1 : 0);
  signInHistoryShowingEnd = computed(() => Math.min(this.signInHistoryCurrentPage() * this.signInPageSize(), this.signInHistory().length));

  sort(field: string) {
    if (this.sortField() === field) this.sortAsc.set(!this.sortAsc());
    else { this.sortField.set(field); this.sortAsc.set(true); }
  }

  constructor(public data: DataService, public auth: AuthService, private ui: UiService) {}

  ngOnInit() { void this.data.loadUsers(); }

  openSignInHistory() {
    if (!this.auth.isAdmin()) return;
    this.signInHistoryOpen.set(true);
    this.refreshSignInHistory();
  }
  closeSignInHistory() { this.signInHistoryOpen.set(false); }
  refreshSignInHistory() { void this.data.loadSignInHistory(); }
  private localDateKey(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  securityEventProfile(username: string): User | undefined {
    const sought = String(username || '').trim().toLowerCase();
    return this.data.signInProfiles().find(profile =>
      profile.username.toLowerCase() === sought || String(profile.email || '').toLowerCase() === sought);
  }
  updateSignInUserFilter(value: string) { this.signInUserFilter.set(value); this.signInPage.set(1); }
  updateSignInFromDate(value: string) { this.signInFromDate.set(value); this.signInPage.set(1); }
  updateSignInToDate(value: string) { this.signInToDate.set(value); this.signInPage.set(1); }
  updateSignInEventFilter(value: string) { this.signInEventFilter.set(value); this.signInPage.set(1); }
  updateSignInPageSize(value: number) { this.signInPageSize.set(value); this.signInPage.set(1); }
  clearSignInFilters() {
    this.signInUserFilter.set('');
    this.signInFromDate.set('');
    this.signInToDate.set('');
    this.signInEventFilter.set('all');
    this.signInPage.set(1);
  }
  previousSignInPage() { this.signInPage.set(Math.max(1, this.signInHistoryCurrentPage() - 1)); }
  nextSignInPage() { this.signInPage.set(Math.min(this.signInHistoryPages(), this.signInHistoryCurrentPage() + 1)); }
  securityEventLabel(action: string): string {
    if (action === 'User logged in') return 'Signed in';
    if (action === 'User logged out') return 'Signed out';
    if (action.startsWith('Sign-in failed')) return 'Failed sign-in attempt';
    return 'Sign-in blocked after repeated failures';
  }
  securityEventIcon(action: string): string {
    if (action === 'User logged in') return 'fa-arrow-right-to-bracket text-emerald-500';
    if (action === 'User logged out') return 'fa-arrow-right-from-bracket text-slate-400';
    if (action.startsWith('Sign-in failed')) return 'fa-triangle-exclamation text-amber-500';
    return 'fa-shield-halved text-amber-500';
  }
  securityEventTime(timestamp: string): string {
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toLocaleString();
  }

  openAccess(user?: User) {
    if (!this.auth.isAdmin()) return;
    this.selectedAccessUser.set(user?.username || '');
    this.loadSelectedPermissions();
    this.accessOpen.set(true);
  }
  closeAccess() { if (!this.savingPermissions()) this.accessOpen.set(false); }
  selectedUser(): User | undefined { return this.data.users().find(user => user.username === this.selectedAccessUser()); }
  hasPermission(key: string): boolean { return this.selectedPermissions().includes(key) || (key === 'dropdowns.view' && this.selectedPermissions().includes('dropdowns.manage')); }
  permissionKey(section: string, action: string): string { return `${section}.${action}`; }
  permissionAction(section: string, action: string): PermissionAction | undefined { return this.permissionSections.find(group => group.key === section)?.actions.find(item => item.key === action); }
  hasSectionAction(section: string, action: string): boolean { return !!this.permissionAction(section, action); }
  private loadSelectedPermissions() {
    const user = this.selectedUser();
    if (!user) { this.selectedPermissions.set([]); return; }
    const permissions = user.role === 'admin' ? [...this.allPermissionKeys] : [...(user.permissions ?? roleDefaultPermissions(user.role))];
    if (!permissions.includes('dashboard.view')) permissions.push('dashboard.view');
    this.selectedPermissions.set(permissions);
  }
  selectAccessUser(username: string) { this.selectedAccessUser.set(username); this.loadSelectedPermissions(); }
  togglePermission(section: string, action: string, checked: boolean) {
    const user = this.selectedUser();
    if (!user || user.role === 'admin') return;
    const key = this.permissionKey(section, action);
    if (key === 'dashboard.view' && !checked) return;
    if ((key === 'users.manage' || key === 'backup.manage')) return;
    const next = new Set(this.selectedPermissions());
    if (action === 'view' && !checked) {
      for (const item of this.permissionSections.find(group => group.key === section)?.actions || []) next.delete(this.permissionKey(section, item.key));
    } else if (checked) {
      next.add(key);
      if (action !== 'view') next.add(this.permissionKey(section, 'view'));
    } else next.delete(key);
    this.selectedPermissions.set([...next]);
  }
  async savePermissions() {
    const user = this.selectedUser();
    if (!this.auth.isAdmin() || !user || user.role === 'admin' || this.savingPermissions()) return;
    if (this.selectedPermissions().includes('users.manage') || this.selectedPermissions().includes('backup.manage')) {
      this.ui.error('System user management and backup permissions are reserved for Admin accounts.'); return;
    }
    this.savingPermissions.set(true);
    const result = await this.data.updateUser(user.username, { permissions: this.selectedPermissions() });
    this.savingPermissions.set(false);
    if (!result.ok) { this.ui.error(result.error || 'Could not save user permissions.'); return; }
    this.ui.success(`Individual permissions saved for ${user.displayName || user.username}.`);
  }
  async resetPermissions() {
    const user = this.selectedUser();
    if (!this.auth.isAdmin() || !user || user.role === 'admin' || this.savingPermissions()) return;
    const confirmed = await this.ui.confirm({ title: 'Reset individual permissions', message: `Reset ${user.displayName || user.username} to the standard ${user.role} role permissions?`, confirmLabel: 'Reset permissions' });
    if (!confirmed) return;
    this.savingPermissions.set(true);
    const result = await this.data.updateUser(user.username, { permissions: null });
    this.savingPermissions.set(false);
    if (!result.ok) { this.ui.error(result.error || 'Could not reset permissions.'); return; }
    this.loadSelectedPermissions();
    this.ui.success('User now inherits permissions from their access role.');
  }

  openModal() {
    if (!this.auth.isAdmin()) { this.ui.error('Admin access required.'); return; }
    this.newDisplayName = '';
    this.newEmail = '';
    this.newPassword = '';
    this.newRole.set('viewer');
    this.newTitle = '';
    this.modalOpen.set(true);
  }
  closeModal() { this.modalOpen.set(false); }

  async addUser(event: Event) {
    event.preventDefault();
    if (!this.auth.isAdmin()) return;
    const displayName = this.newDisplayName.trim();
    const email = this.newEmail.trim().toLowerCase();
    const pass = this.newPassword.trim();
    const role = this.newRole();
    const title = this.newTitle.trim();
    if (!displayName) { this.ui.error('Enter the user’s display name.'); return; }
    if (!/^[^\s@]+@ccrn\.com$/i.test(email)) { this.ui.error('Enter a valid company email ending in @ccrn.com.'); return; }
    if (pass.length < 8) { this.ui.error('Password must be at least 8 characters.'); return; }
    if (this.data.users().some(u => (u.email || '').toLowerCase() === email)) { this.ui.error('A user with this company email already exists.'); return; }
    const res = await this.data.addUser(displayName, email, pass, role, title);
    if (!res.ok) { this.ui.error(res.error || 'Could not add user.'); return; }
    this.ui.success(`User "${displayName}" added.`);
    this.closeModal();
  }

  // ---- Edit user ----
  openEdit(user: User) {
    if (!this.auth.isAdmin()) { this.ui.error('Admin access required.'); return; }
    this.editUsername = user.username;
    this.editDisplayName = user.displayName || user.username;
    this.editEmail = user.email || '';
    this.editRole.set(user.role);
    this.editTitle = user.title || '';
    this.editPassword = '';
    this.editOpen.set(true);
  }
  closeEdit() { this.editOpen.set(false); }

  async saveEdit() {
    if (!this.auth.isAdmin() || this.editSaving()) return;
    const pass = this.editPassword.trim();
    if (pass && pass.length < 8) { this.ui.error('Password must be at least 8 characters.'); return; }
    const displayName = this.editDisplayName.trim();
    if (!displayName) { this.ui.error('Display name is required.'); return; }
    const email = this.editEmail.trim().toLowerCase();
    if (!/^[^\s@]+@ccrn\.com$/i.test(email)) { this.ui.error('Enter a valid company email ending in @ccrn.com.'); return; }
    if (this.data.users().some(u => u.username !== this.editUsername && (u.email || '').toLowerCase() === email)) { this.ui.error('A user with this company email already exists.'); return; }
    // The primary admin cannot be demoted (server enforces this too) — pin the
    // role so an accidental change in the form never triggers a server rejection.
    const role = this.editUsername.toLowerCase() === 'admin' ? 'admin' : this.editRole();
    const current = this.data.users().find(user => user.username === this.editUsername);
    const roleChanged = !!current && current.role !== role;
    if (roleChanged || pass) {
      const changesText = [
        roleChanged ? `change access from ${current!.role} to ${role}` : '',
        pass ? 'reset the password' : ''
      ].filter(Boolean).join(' and ');
      const ok = await this.ui.confirm({ title: 'Confirm sensitive user change', message: `This will ${changesText} for ${displayName}. Continue?`, confirmLabel: 'Save changes' });
      if (!ok) return;
    }
    const changes: { role?: string; pass?: string; email?: string; displayName?: string; title?: string } = { role, email, displayName, title: this.editTitle.trim() };
    if (pass) changes.pass = pass;
    this.editSaving.set(true);
    const res = await this.data.updateUser(this.editUsername, changes);
    this.editSaving.set(false);
    if (!res.ok) { this.ui.error(res.error || 'Could not update the user.'); return; }
    const updatedUser = this.data.users().find(user => user.username === this.editUsername);
    if (updatedUser) this.auth.syncCurrentUser(updatedUser);
    this.ui.success(`User "${displayName}" updated.`);
    this.closeEdit();
  }

  async deleteUser(user: User) {
    if (!this.auth.isAdmin()) return;
    const label = user.displayName || user.email || user.username;
    const ok = await this.ui.confirm({ title: 'Delete user', message: `Delete user "${label}"? This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const res = await this.data.deleteUser(user.username);
    if (!res.ok) this.ui.error(res.error || 'Could not delete the user.');
    else this.ui.success(`User "${label}" deleted.`);
  }

  // ---- Backup / Restore (admin) ----
  /** Download a JSON snapshot of asset data, employee notes, and logs. User
   *  accounts and passwords are intentionally NOT included. */
  async downloadBackup() {
    if (!this.auth.isAdmin() || this.backupBusy()) return;
    this.backupBusy.set(true);
    try {
      const snapshot = await this.data.backup();
      const json = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `AssetFlow_Backup_${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      this.ui.success('Backup downloaded.');
    } catch {
      this.ui.error('Could not create the backup.');
    } finally {
      this.backupBusy.set(false);
    }
  }

  /** Restore from a previously downloaded snapshot. Replaces asset data, employee
   *  notes, and logs — never touches user accounts. */
  onRestoreFile(event: Event) {
    if (!this.auth.isAdmin()) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      let snapshot: any;
      try {
        snapshot = JSON.parse((e.target as FileReader).result as string);
      } catch {
        this.ui.error('That file is not valid JSON.');
        input.value = '';
        return;
      }
      if (!snapshot || !Array.isArray(snapshot.assets)) {
        this.ui.error('This does not look like an AssetFlow backup (no "assets" found).');
        input.value = '';
        return;
      }
      const ok = await this.ui.confirm({
        title: 'Restore data snapshot',
        message: `This will REPLACE all current assets, employee notes, and logs with the ${snapshot.assets.length} asset(s) in this backup. User accounts are unaffected. This cannot be undone. Continue?`,
        confirmLabel: 'Restore', danger: true
      });
      if (!ok) { input.value = ''; return; }
      this.restoreBusy.set(true);
      const res = await this.data.restore(snapshot);
      this.restoreBusy.set(false);
      input.value = '';
      if (!res.ok) { this.ui.error(res.error || 'Could not restore the snapshot.'); return; }
      this.ui.success(`Restored ${res.restored} asset(s)` + (res.skipped ? `, skipped ${res.skipped}.` : '.'));
    };
    reader.readAsText(file);
  }
}
