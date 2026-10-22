import { Injectable, inject, signal, computed } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AccessoryChecklist, Asset, AssetAssignmentType, AssetCondition, AuditLog, CommentEntry, Consumable, DellCase, DeskPeripheral, Employee, FormerEmployeeRecord, OffboardingChecklist, OffboardingChecklistItem, QuickLink, User } from '../models/models';
import { ApiService, errorMessage } from './api.service';

export const CATALOG: Record<string, string[]> = {
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
export const CATEGORIES = ['Laptop', 'Monitor', 'Mouse', 'Docking Station', 'Headset'];
export const DEPARTMENTS = ['IT', 'BPS', 'HR', 'Finance', 'Admin'];
export const STATUSES = ['In Use', 'In Storage', 'Under Repair'];
export interface DropdownOptions { assetCategories: string[]; assetModels: Record<string, string[]>; deskCategories: string[]; consumableCategories: string[]; consumableUnits: string[]; }
const DEFAULT_DROPDOWNS: DropdownOptions = { assetCategories: [...CATEGORIES], assetModels: structuredClone(CATALOG), deskCategories: ['Monitor', 'Docking Station'], consumableCategories: ['Cables', 'Adapters', 'Peripherals', 'Storage', 'Power', 'Accessories', 'Other'], consumableUnits: ['pcs', 'boxes', 'packs', 'sets', 'metres'] };

export interface ArchivedRecord {
  id: number;
  type: 'asset' | 'employee' | 'consumable' | 'deskPeripheral' | 'dellCase' | 'quickLink';
  record: any;
  deletedAt: string;
  deletedBy: string;
}

type Result = { ok: boolean; error?: string; asset?: Asset };
interface SignInHistoryResponse { events: AuditLog[]; profiles: User[]; }

/**
 * Reactive store backed by the REST API. Components still read the signals
 * synchronously (assets(), users(), auditLogs()); every mutation calls the
 * server and then refreshes the relevant signal so the UI stays in sync.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private api = inject(ApiService);
  private liveSyncTimer: ReturnType<typeof setInterval> | null = null;
  private liveSyncRoute: (() => string) | null = null;
  private liveSyncBusy = false;
  private liveSyncVersion = '';
  private readonly onLiveSyncVisible = () => { if (document.visibilityState === 'visible') void this.checkForRemoteChanges(); };

  dropdownOptions = signal<DropdownOptions>(DEFAULT_DROPDOWNS);
  readonly catalog = computed(() => this.dropdownOptions().assetModels);
  readonly categories = computed(() => this.dropdownOptions().assetCategories);
  readonly deskCategories = computed(() => this.dropdownOptions().deskCategories);
  readonly consumableCategories = computed(() => this.dropdownOptions().consumableCategories);
  readonly consumableUnits = computed(() => this.dropdownOptions().consumableUnits);
  readonly departments = DEPARTMENTS;
  readonly statuses = STATUSES;

  startLiveSync(route: () => string, onChange?: () => void): void {
    this.stopLiveSync();
    this.liveSyncRoute = route;
    this.liveSyncOnChange = onChange || null;
    void this.checkForRemoteChanges();
    this.liveSyncTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.checkForRemoteChanges();
    }, 20_000);
    document.addEventListener('visibilitychange', this.onLiveSyncVisible);
  }

  stopLiveSync(): void {
    if (this.liveSyncTimer) clearInterval(this.liveSyncTimer);
    this.liveSyncTimer = null;
    document.removeEventListener('visibilitychange', this.onLiveSyncVisible);
    this.liveSyncRoute = null;
    this.liveSyncOnChange = null;
    this.liveSyncVersion = '';
    this.liveSyncBusy = false;
  }

  private liveSyncOnChange: (() => void) | null = null;

  private async checkForRemoteChanges(): Promise<void> {
    if (this.liveSyncBusy || !this.liveSyncRoute) return;
    this.liveSyncBusy = true;
    try {
      const { version } = await firstValueFrom(this.api.get<{ version: string }>('/changes'));
      if (!this.liveSyncVersion) this.liveSyncVersion = version;
      else if (version && version !== this.liveSyncVersion) {
        this.liveSyncVersion = version;
        await this.refreshVisibleModule(this.liveSyncRoute());
        this.liveSyncOnChange?.();
      }
    } catch { /* Re-check after the next interval or when the tab becomes visible. */ }
    finally { this.liveSyncBusy = false; }
  }

  private async refreshVisibleModule(path: string): Promise<void> {
    const route = path.split('?')[0];
    if (route === '/dropdowns') await this.loadDropdownOptions();
    else if (route === '/dashboard' || route === '/entry') {
      await Promise.all([this.loadAssets(), this.loadDellCases()]);
    } else if (route === '/desk-setup') await this.loadDeskPeripherals();
    else if (route === '/consumables') await this.loadConsumables();
    else if (route === '/employees' || route.startsWith('/employees/')) {
      await Promise.all([this.loadAssets(), this.loadEmployees(), this.loadEmployeeComments()]);
    } else if (route === '/manage-employees') await Promise.all([this.loadAssets(), this.loadEmployees()]);
    else if (route === '/returns') await Promise.all([this.loadAssets(), this.loadOffboardingChecklists(), this.loadFormerEmployees()]);
    else if (route === '/former-employees') await this.loadFormerEmployees();
    else if (route === '/dell-cases') await Promise.all([this.loadDellCases(), this.loadAssets(), this.loadEmployees(), this.loadFormerEmployees()]);
    else if (route === '/warranty') await Promise.all([this.loadAssets(), this.loadDellCases()]);
    else if (route === '/links') await this.loadQuickLinks();
    else if (route === '/logs') await this.loadLogs();
    else if (route === '/users') await this.loadUsers();
  }

  assets = signal<Asset[]>([]);
  users = signal<User[]>([]);
  auditLogs = signal<AuditLog[]>([]);
  signInEvents = signal<AuditLog[]>([]);
  signInProfiles = signal<User[]>([]);
  signInHistoryLoading = signal(false);
  signInHistoryError = signal('');
  logsLoading = signal(false);
  logsError = signal('');
  displayNameFor(username: string): string {
    const value = String(username || '').trim();
    if (!value) return 'User';
    const account = this.users().find(user =>
      user.username.toLowerCase() === value.toLowerCase() || String(user.email || '').toLowerCase() === value.toLowerCase());
    return account?.displayName?.trim() || value;
  }
  /** Employee-level comments, keyed by employee name (employees have no asset id). */
  employeeComments = signal<Record<string, CommentEntry[]>>({});
  /** Quantity-tracked consumables (admin-managed). */
  consumables = signal<Consumable[]>([]);
  consumablesLoading = signal(false);
  consumablesError = signal('');

  /** True while the very first asset load is in flight — drives loading skeletons.
   *  Only the initial fetch (empty list) flips this; background refreshes stay quiet. */
  assetsLoading = signal<boolean>(true);

  /** The employee roster loaded from the backend table (GET /api/employees). */
  employeeRoster = signal<Employee[]>([]);
  deskPeripherals = signal<DeskPeripheral[]>([]);
  deskPeripheralsError = signal('');
  formerEmployees = signal<FormerEmployeeRecord[]>([]);
  offboardingChecklists = signal<OffboardingChecklist[]>([]);
  formerEmployeesError = signal('');
  recoveryArchive = signal<ArchivedRecord[]>([]);
  dellCases = signal<DellCase[]>([]);
  /** Index Dell cases by normalized asset serial. Asset rows read this during
   *  change detection, so precompute the join once per case-list update instead
   *  of scanning every case for every visible asset. */
  private dellCasesBySerial = computed(() => {
    const bySerial = new Map<string, DellCase[]>();
    for (const row of this.dellCases()) {
      const serial = String(row.assetSerial || '').trim().toLowerCase();
      if (!serial) continue;
      const linked = bySerial.get(serial);
      if (linked) linked.push(row);
      else bySerial.set(serial, [row]);
    }
    return bySerial;
  });
  dellCasesLoaded = signal(false);
  dellCasesError = signal('');
  quickLinks = signal<QuickLink[]>([]);
  quickLinksError = signal('');

  /** Known employee names for pickers/autocomplete. Primarily the backend roster,
   *  unioned with any names still present on assets so nothing is ever missing
   *  (e.g. if the roster hasn't loaded yet). Unique, sorted, excludes "Stock". */
  employees = computed<string[]>(() => {
    const fromRoster = this.employeeRoster().map(e => (e.name || '').trim());
    const fromAssets = this.assets().map(a => (a.assignedTo || '').trim());
    const names = [...fromRoster, ...fromAssets].filter(n => n && !['stock', 'unassigned'].includes(n.toLowerCase()));
    // Case-insensitive de-dupe while keeping the first spelling seen.
    const seen = new Map<string, string>();
    for (const n of names) { const k = n.toLowerCase(); if (!seen.has(k)) seen.set(k, n); }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  });

  // ---- Loaders ----
  /** Reset every in-memory signal to empty. Called on logout so one user's data
   *  never lingers into the next session on the same browser tab. */
  clearAll(): void {
    this.dropdownOptions.set(DEFAULT_DROPDOWNS);
    this.assets.set([]);
    this.users.set([]);
    this.auditLogs.set([]);
    this.logsError.set('');
    this.signInEvents.set([]);
    this.signInProfiles.set([]);
    this.signInHistoryError.set('');
    this.signInHistoryLoading.set(false);
    this.employeeComments.set({});
    this.consumables.set([]);
    this.consumablesLoading.set(false);
    this.consumablesError.set('');
    this.employeeRoster.set([]);
    this.deskPeripherals.set([]);
    this.formerEmployees.set([]);
    this.offboardingChecklists.set([]);
    this.dellCases.set([]);
    this.dellCasesLoaded.set(false);
    this.quickLinks.set([]);
    this.deskPeripheralsError.set('');
    this.formerEmployeesError.set('');
    this.dellCasesError.set('');
    this.quickLinksError.set('');
    this.assetsLoading.set(true);
    this.recoveryArchive.set([]);
  }

  async loadAssets(): Promise<void> {
    const first = this.assets().length === 0;
    if (first) this.assetsLoading.set(true);
    try { this.assets.set(await firstValueFrom(this.api.get<Asset[]>('/assets'))); }
    catch { /* interceptor handles 401; leave existing data on transient errors */ }
    finally { this.assetsLoading.set(false); }
  }
  async loadEmployeeComments(): Promise<void> {
    try { this.employeeComments.set(await firstValueFrom(this.api.get<Record<string, CommentEntry[]>>('/employee-comments'))); }
    catch { /* older server without the endpoint, or transient error; keep existing */ }
  }
  async loadUsers(): Promise<void> {
    try { this.users.set(await firstValueFrom(this.api.get<User[]>('/users'))); }
    catch { /* admin-only; ignore */ }
  }
  async loadLogs(): Promise<boolean> {
    this.logsLoading.set(true);
    this.logsError.set('');
    try {
      this.auditLogs.set(await firstValueFrom(this.api.get<AuditLog[]>('/logs')));
      return true;
    } catch (e) {
      this.logsError.set(errorMessage(e, 'Could not load system activity logs.'));
      return false;
    } finally {
      this.logsLoading.set(false);
    }
  }
  async loadDropdownOptions(): Promise<void> {
    try { this.dropdownOptions.set(await firstValueFrom(this.api.get<DropdownOptions>('/dropdown-options'))); } catch { /* retain defaults on unavailable API */ }
  }
  async saveDropdownOptions(options: DropdownOptions): Promise<Result> {
    try {
      this.dropdownOptions.set(await firstValueFrom(this.api.put<DropdownOptions>('/dropdown-options', options)));
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not save dropdown data.') }; }
  }
  async loadSignInHistory(): Promise<boolean> {
    this.signInHistoryLoading.set(true);
    this.signInHistoryError.set('');
    try {
      const history = await firstValueFrom(this.api.get<SignInHistoryResponse>('/sign-in-events'));
      this.signInEvents.set(history.events || []);
      this.signInProfiles.set(history.profiles || []);
      return true;
    } catch (e) {
      this.signInHistoryError.set(errorMessage(e, 'Could not load sign-in activity.'));
      return false;
    } finally {
      this.signInHistoryLoading.set(false);
    }
  }
  async loadConsumables(): Promise<void> {
    this.consumablesLoading.set(true);
    this.consumablesError.set('');
    try { this.consumables.set(await firstValueFrom(this.api.get<Consumable[]>('/consumables'))); }
    catch (e) { this.consumablesError.set(errorMessage(e, 'Could not load consumables inventory.')); }
    finally { this.consumablesLoading.set(false); }
  }
  async importConsumables(rows: any[]): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const result = await firstValueFrom(this.api.post<{ imported: number; skipped: number; errors: string[] }>('/consumables/import', { rows }));
    await this.loadConsumables(); return result;
  }
  async loadEmployees(): Promise<void> {
    try { this.employeeRoster.set(await firstValueFrom(this.api.get<Employee[]>('/employees'))); }
    catch { /* older server without the endpoint, or transient error; keep existing */ }
  }

  async loadOffboardingChecklists(): Promise<void> {
    try { this.offboardingChecklists.set(await firstValueFrom(this.api.get<OffboardingChecklist[]>('/offboarding-checklists'))); }
    catch { /* keep any locally loaded checklists after a transient request failure */ }
  }
  async startOffboardingChecklist(employeeName: string): Promise<{ ok: boolean; checklist?: OffboardingChecklist; error?: string }> {
    try {
      const checklist = await firstValueFrom(this.api.post<OffboardingChecklist>('/offboarding-checklists', { employeeName }));
      // Show the new checklist and its return controls immediately, even if the
      // follow-up refresh is temporarily unavailable.
      this.offboardingChecklists.update(all => [checklist, ...all.filter(existing => existing.id !== checklist.id)]);
      await this.loadOffboardingChecklists();
      return { ok: true, checklist };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not start the offboarding checklist.') }; }
  }
  async returnOffboardingItem(checklistId: number, item: OffboardingChecklistItem, accessories: AccessoryChecklist, condition: AssetCondition): Promise<{ ok: boolean; error?: string }> {
    try {
      const checklist = await firstValueFrom(this.api.post<OffboardingChecklist>(`/offboarding-checklists/${checklistId}/items/${item.assetId}/return`, { accessories, condition }));
      this.offboardingChecklists.update(all => [checklist, ...all.filter(c => c.id !== checklist.id)]);
      const refreshes = [this.loadAssets()];
      if (checklist.completedAt) refreshes.push(this.loadFormerEmployees(), this.loadEmployees());
      await Promise.all(refreshes);
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not record this return.') }; }
  }

  async loadDeskPeripherals(): Promise<void> {
    try { this.deskPeripherals.set(await firstValueFrom(this.api.get<DeskPeripheral[]>('/desk-peripherals'))); this.deskPeripheralsError.set(''); }
    catch (e) { this.deskPeripheralsError.set(errorMessage(e, 'Could not load desk setups.')); }
  }
  async saveDeskPeripheral(record: Partial<DeskPeripheral>): Promise<Result> {
    try {
      if (record.id != null) await firstValueFrom(this.api.put<DeskPeripheral>(`/desk-peripherals/${record.id}`, record));
      else await firstValueFrom(this.api.post<DeskPeripheral>('/desk-peripherals', record));
      await this.loadDeskPeripherals();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not save the desk setup.') }; }
  }
  async deleteDeskPeripheral(id: number): Promise<Result> {
    try {
      await firstValueFrom(this.api.delete(`/desk-peripherals/${id}`));
      await this.loadDeskPeripherals();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not remove the desk setup.') }; }
  }
  /** Bulk-import desk setups (monitors / docking stations) from spreadsheet rows. */
  async importDeskPeripherals(rows: any[]): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const res = await firstValueFrom(
      this.api.post<{ imported: number; skipped: number; errors: string[] }>('/desk-peripherals/import', { rows })
    );
    await this.loadDeskPeripherals();
    return res;
  }

  async loadFormerEmployees(): Promise<void> {
    try { this.formerEmployees.set(await firstValueFrom(this.api.get<FormerEmployeeRecord[]>('/former-employees'))); this.formerEmployeesError.set(''); }
    catch (e) { this.formerEmployeesError.set(errorMessage(e, 'Could not load former employee records.')); }
  }
  async archiveEmployee(name: string): Promise<Result> {
    try {
      await firstValueFrom(this.api.post<FormerEmployeeRecord>(`/former-employees/${encodeURIComponent(name)}/archive`, {}));
      await Promise.all([this.loadFormerEmployees(), this.loadEmployees(), this.loadAssets()]);
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not archive the former employee.') }; }
  }
  async loadDellCases(): Promise<void> {
    try { this.dellCases.set(await firstValueFrom(this.api.get<DellCase[]>('/dell-cases'))); this.dellCasesError.set(''); this.dellCasesLoaded.set(true); }
    catch (e) { this.dellCasesError.set(errorMessage(e, 'Could not load Dell cases.')); this.dellCasesLoaded.set(false); }
  }
  /** Repair-status dot is joined by normalized serial; only Unresolved cases are open. */
  repairCaseId(asset: Asset): number | null {
    if (asset.status !== 'Under Repair' || !this.dellCasesLoaded()) return null;
    const serial = String(asset.serial || '').trim().toLowerCase();
    const linked = this.dellCasesBySerial().get(serial) ?? [];
    return (linked.find(row => row.status === 'Unresolved') ?? linked.find(row => row.status === 'Resolved'))?.id ?? null;
  }
  repairCaseIndicator(asset: Asset): 'open' | 'resolved' | 'missing' | null {
    if (asset.status !== 'Under Repair' || !this.dellCasesLoaded()) return null;
    const serial = String(asset.serial || '').trim().toLowerCase();
    const linked = this.dellCasesBySerial().get(serial) ?? [];
    if (linked.some(row => row.status === 'Unresolved')) return 'open';
    if (linked.some(row => row.status === 'Resolved')) return 'resolved';
    return 'missing';
  }
  async importDellCases(rows: any[]): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const result = await firstValueFrom(this.api.post<{ imported: number; skipped: number; errors: string[] }>('/dell-cases/import', { rows }));
    await this.loadDellCases(); return result;
  }
  async saveDellCase(record: Partial<DellCase>): Promise<Result> {
    try {
      if (record.id != null) await firstValueFrom(this.api.put<DellCase>(`/dell-cases/${record.id}`, record));
      else await firstValueFrom(this.api.post<DellCase>('/dell-cases', record));
      await this.loadDellCases();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not save the Dell case.') }; }
  }
  async deleteDellCase(id: number): Promise<Result> {
    try {
      await firstValueFrom(this.api.delete(`/dell-cases/${id}`));
      await this.loadDellCases();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not remove the Dell case.') }; }
  }
  async addDellCaseComment(caseId: number, text: string): Promise<Result> {
    try { await firstValueFrom(this.api.post(`/dell-cases/${caseId}/comments`, { text })); await this.loadDellCases(); return { ok: true }; }
    catch (e) { return { ok: false, error: errorMessage(e, 'Could not add the comment.') }; }
  }
  async editDellCaseComment(caseId: number, commentId: number, text: string): Promise<Result> {
    try { await firstValueFrom(this.api.put(`/dell-cases/${caseId}/comments/${commentId}`, { text })); await this.loadDellCases(); return { ok: true }; }
    catch (e) { return { ok: false, error: errorMessage(e, 'Could not update the comment.') }; }
  }
  async deleteDellCaseComment(caseId: number, commentId: number): Promise<Result> {
    try { await firstValueFrom(this.api.delete(`/dell-cases/${caseId}/comments/${commentId}`)); await this.loadDellCases(); return { ok: true }; }
    catch (e) { return { ok: false, error: errorMessage(e, 'Could not delete the comment.') }; }
  }
  async loadQuickLinks(): Promise<void> {
    try { this.quickLinks.set(await firstValueFrom(this.api.get<QuickLink[]>('/links'))); this.quickLinksError.set(''); }
    catch (e) { this.quickLinksError.set(errorMessage(e, 'Could not load shared links.')); }
  }
  async importQuickLinks(rows: any[]): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const result = await firstValueFrom(this.api.post<{ imported: number; skipped: number; errors: string[] }>('/links/import', { rows }));
    await this.loadQuickLinks();
    return result;
  }
  async addQuickLink(link: { name: string; url: string; purpose: string }): Promise<Result> {
    try {
      await firstValueFrom(this.api.post<QuickLink>('/links', link));
      await this.loadQuickLinks();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not add the link.') }; }
  }
  async deleteQuickLink(id: number): Promise<Result> {
    try {
      await firstValueFrom(this.api.delete(`/links/${id}`));
      await this.loadQuickLinks();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not remove the link.') }; }
  }

  // ---- Employee roster operations ----
  async addEmployee(name: string, department = '', cciId = ''): Promise<Result> {
    try {
      await firstValueFrom(this.api.post<Employee>('/employees', { name, department, cciId }));
      await this.loadEmployees();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not add the employee.') }; }
  }
  async importEmployees(rows: any[]): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const result = await firstValueFrom(this.api.post<{ imported: number; skipped: number; errors: string[] }>('/employees/import', { rows }));
    await Promise.all([this.loadEmployees(), this.loadAssets()]);
    return result;
  }
  async updateEmployee(currentName: string, changes: { name?: string; department?: string; cciId?: string }): Promise<Result> {
    try {
      const updated = await firstValueFrom(this.api.put<Employee>(`/employees/${encodeURIComponent(currentName)}`, changes));
      if (changes.cciId !== undefined) {
        const expectedId = changes.cciId.trim().replace(/^CCI/i, '');
        if ((updated.cciId || '') !== expectedId) {
          return { ok: false, error: 'The API did not save this CCIID. Restart the AssetFlow API server, then try again.' };
        }
      }
      this.employeeRoster.update(list => list.map(employee =>
        employee.name.toLowerCase() === currentName.toLowerCase() ? updated : employee
      ));
      await this.loadAssets();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not update the employee.') }; }
  }
  async deleteEmployee(name: string): Promise<Result> {
    try {
      await firstValueFrom(this.api.delete(`/employees/${encodeURIComponent(name)}`));
      await this.loadEmployees();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not remove the employee.') }; }
  }

  // ---- Asset operations ----
  async addAsset(asset: Partial<Asset> & { comment?: string; allowDuplicateAssignment?: boolean }): Promise<Result> {
    try {
      const createdAsset = await firstValueFrom(this.api.post<Asset>('/assets', asset));
      await this.loadAssets();
      return { ok: true, asset: createdAsset };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not save the asset.') }; }
  }

  async updateAsset(id: number, asset: Partial<Asset>): Promise<Result> {
    try {
      await firstValueFrom(this.api.put<Asset>(`/assets/${id}`, asset));
      await this.loadAssets();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not update the asset.') }; }
  }

  async deleteAsset(id: number): Promise<Result> {
    try {
      await firstValueFrom(this.api.delete(`/assets/${id}`));
      await this.loadAssets();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not delete the asset.') }; }
  }

  async loadRecoveryArchive(): Promise<void> {
    try { this.recoveryArchive.set(await firstValueFrom(this.api.get<ArchivedRecord[]>('/recovery-archive'))); }
    catch (e) { throw new Error(errorMessage(e, 'Could not load the recovery archive.')); }
  }

  async restoreArchivedRecord(id: number): Promise<Result> {
    try {
      await firstValueFrom(this.api.post(`/recovery-archive/${id}/restore`, {}));
      await Promise.all([this.loadRecoveryArchive(), this.loadAssets(), this.loadEmployees(), this.loadConsumables(), this.loadDeskPeripherals(), this.loadDellCases(), this.loadQuickLinks()]);
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not restore this record.') }; }
  }

  /** Check-in / check-out a single asset: reassign to a person or storage, with an
   *  optional status change and reason. Returns the reason recorded on history. */
  async assignAsset(id: number, opts: { assignedTo: string; status?: string; reason?: string; assignmentType?: AssetAssignmentType; handoverChecklist?: AccessoryChecklist; condition?: AssetCondition }): Promise<Result> {
    try {
      await firstValueFrom(this.api.post(`/assets/${id}/assign`, opts));
      await this.loadAssets();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not reassign the asset.') }; }
  }

  /** Bulk assign the selected assets to one employee (or storage), optionally
   *  setting a status too. Returns the number of assets actually changed. */
  async bulkAssign(ids: Set<number>, opts: { assignedTo: string; status?: string; reason?: string; assignmentType?: AssetAssignmentType }): Promise<number> {
    const res = await firstValueFrom(this.api.post<{ count: number }>('/assets/bulk-assign', { ids: [...ids], ...opts }));
    await this.loadAssets();
    return res.count;
  }

  // ---- Asset comments ----
  async addComment(assetId: number, text: string): Promise<Result> {
    try {
      await firstValueFrom(this.api.post(`/assets/${assetId}/comments`, { text }));
      await this.loadAssets();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not add the comment.') }; }
  }

  async deleteComment(assetId: number, commentId: number): Promise<Result> {
    try {
      await firstValueFrom(this.api.delete(`/assets/${assetId}/comments/${commentId}`));
      await this.loadAssets();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not delete the comment.') }; }
  }

  async editComment(assetId: number, commentId: number, text: string): Promise<Result> {
    try {
      await firstValueFrom(this.api.put(`/assets/${assetId}/comments/${commentId}`, { text }));
      await this.loadAssets();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not update the comment.') }; }
  }

  // ---- Employee comments (keyed by employee name) ----
  async addEmployeeComment(name: string, text: string): Promise<Result> {
    try {
      await firstValueFrom(this.api.post(`/employee-comments/${encodeURIComponent(name)}`, { text }));
      await this.loadEmployeeComments();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not add the comment.') }; }
  }

  async editEmployeeComment(name: string, commentId: number, text: string): Promise<Result> {
    try {
      await firstValueFrom(this.api.put(`/employee-comments/${encodeURIComponent(name)}/${commentId}`, { text }));
      await this.loadEmployeeComments();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not update the comment.') }; }
  }

  async deleteEmployeeComment(name: string, commentId: number): Promise<Result> {
    try {
      await firstValueFrom(this.api.delete(`/employee-comments/${encodeURIComponent(name)}/${commentId}`));
      await this.loadEmployeeComments();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not delete the comment.') }; }
  }

  async bulkUpdateStatus(ids: Set<number>, status: string): Promise<{ ok: boolean; count?: number; error?: string }> {
    try {
      const res = await firstValueFrom(this.api.post<{ count: number }>('/assets/bulk-status', { ids: [...ids], status }));
      await this.loadAssets();
      return { ok: true, count: res.count };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not update asset statuses.') }; }
  }

  async bulkDelete(ids: Set<number>): Promise<number> {
    const res = await firstValueFrom(this.api.post<{ count: number }>('/assets/bulk-delete', { ids: [...ids] }));
    await this.loadAssets();
    return res.count;
  }

  async extendWarranty(ids: Set<number>): Promise<number> {
    const res = await firstValueFrom(this.api.post<{ count: number }>('/assets/extend-warranty', { ids: [...ids] }));
    await this.loadAssets();
    return res.count;
  }

  async processReturn(ids: number[]): Promise<number> {
    const res = await firstValueFrom(this.api.post<{ count: number }>('/assets/process-return', { ids }));
    await this.loadAssets();
    return res.count;
  }

  async importAssets(rows: any[]): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const res = await firstValueFrom(
      this.api.post<{ imported: number; skipped: number; errors: string[] }>('/assets/import', { rows })
    );
    await this.loadAssets();
    return res;
  }

  /** Warranty import: updates purchase/warranty dates on existing assets, matched by serial. */
  async importWarranty(rows: any[]): Promise<{ updated: number; skipped: number; errors: string[] }> {
    const res = await firstValueFrom(
      this.api.post<{ updated: number; skipped: number; errors: string[] }>('/assets/warranty-import', { rows })
    );
    await this.loadAssets();
    return res;
  }

  // ---- User operations ----
  async addUser(displayName: string, email: string, pass: string, role: string, title = ''): Promise<Result> {
    try {
      await firstValueFrom(this.api.post<User>('/users', { displayName, email, pass, role, title }));
      await this.loadUsers();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not create the user.') }; }
  }

  /** Update a user's role and/or reset their password (admin only). */
  async updateUser(username: string, changes: { role?: string; pass?: string; email?: string; displayName?: string; title?: string; permissions?: string[] | null }): Promise<Result> {
    try {
      await firstValueFrom(this.api.put<User>(`/users/${encodeURIComponent(username)}`, changes));
      await this.loadUsers();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not update the user.') }; }
  }

  async deleteUser(username: string): Promise<Result> {
    try {
      await firstValueFrom(this.api.delete(`/users/${encodeURIComponent(username)}`));
      await this.loadUsers();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not delete the user.') }; }
  }

  // ---- Logs ----
  async clearLogs(): Promise<void> {
    try {
      await firstValueFrom(this.api.delete('/logs'));
      await this.loadLogs();
    } catch (e) {
      const message = errorMessage(e, 'Could not clear audit logs.');
      this.logsError.set(message);
      throw new Error(message);
    }
  }

  // ---- Consumables (admin) ----
  async addConsumable(item: Partial<Consumable>): Promise<Result> {
    try {
      await firstValueFrom(this.api.post<Consumable>('/consumables', item));
      await this.loadConsumables();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not add the consumable.') }; }
  }

  async updateConsumable(id: number, item: Partial<Consumable>): Promise<Result> {
    try {
      await firstValueFrom(this.api.put<Consumable>(`/consumables/${id}`, item));
      await this.loadConsumables();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not update the consumable.') }; }
  }

  /** Quick +/- stock adjustment. */
  async adjustConsumable(id: number, delta: number): Promise<Result> {
    try {
      await firstValueFrom(this.api.post<Consumable>(`/consumables/${id}/adjust`, { delta }));
      await this.loadConsumables();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not adjust stock.') }; }
  }

  async deleteConsumable(id: number): Promise<Result> {
    try {
      await firstValueFrom(this.api.delete(`/consumables/${id}`));
      await this.loadConsumables();
      return { ok: true };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not delete the consumable.') }; }
  }

  // ---- Backup / Restore (admin) ----
  /** Download a data snapshot (assets, employee notes, logs). Excludes user accounts. */
  async backup(): Promise<any> {
    return firstValueFrom(this.api.get<any>('/backup'));
  }

  /** Restore a previously downloaded snapshot. Replaces asset data + notes + logs. */
  async restore(snapshot: any): Promise<{ ok: boolean; restored?: number; skipped?: number; error?: string }> {
    try {
      const res = await firstValueFrom(this.api.post<{ restored: number; skipped: number }>('/restore', snapshot));
      await this.loadAssets();
      await this.loadEmployeeComments();
      await this.loadConsumables();
      await this.loadEmployees();
      await this.loadLogs();
      return { ok: true, restored: res.restored, skipped: res.skipped };
    } catch (e) { return { ok: false, error: errorMessage(e, 'Could not restore the snapshot.') }; }
  }
}
