import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { DataService } from '../../services/data.service';
import { UiService } from '../../services/ui.service';
import { DellCase, SelectOption } from '../../models/models';
import { EmojiPickerComponent } from '../shared/emoji-picker.component';
import { CustomSelectComponent } from '../shared/custom-select.component';
import { CommentsModalComponent } from '../shared/comments-modal.component';
import { MAX_IMPORT_ROWS, PageResult, exportXlsx, importFileLimitError, pageInfo, paginate } from '../../services/util';

@Component({
  selector: 'app-dell-cases', standalone: true, imports: [CommonModule, FormsModule, EmojiPickerComponent, CustomSelectComponent, CommentsModalComponent],
  templateUrl: './dell-cases.component.html'
})
export class DellCasesComponent implements OnInit {
  pageInfo = pageInfo;
  Infinity = Infinity;
  sizeOptions = [{ value: '10', label: '10' }, { value: '20', label: '20' }, { value: '50', label: '50' }];
  formOpen = signal(false); editingId = signal<number | null>(null); saving = signal(false); error = signal(''); search = signal('');
  commentsCaseId = signal<number | null>(null);
  page = signal(1); size = signal<number>(10);
  categoryFilter = signal(''); modelFilter = signal('');
  sortField = signal<keyof DellCase>('registeredDate'); sortAsc = signal(false);
  employeeName = 'Stock'; category = ''; assetModel = ''; assetSerial = ''; registeredDate = ''; caseId = ''; issueDescription = ''; registeredBy = ''; status = 'Unresolved';
  statuses: DellCase['status'][] = ['Resolved', 'Unresolved', 'Closed without resolved'];
  statusOptions: SelectOption[] = this.statuses.map(value => ({ value, label: value }));
  categoryOptions = computed<SelectOption[]>(() => [{ value: '', label: 'Select category...' }, ...this.data.categories().map(value => ({ value, label: value }))]);
  categoryFilterOptions = computed<SelectOption[]>(() => [{ value: '', label: 'All categories' }, ...this.data.categories().map(value => ({ value, label: value }))]);
  employeeNames = computed(() => [...new Set([...this.data.employeeRoster().map(e => e.name), ...this.data.formerEmployees().map(e => e.name)])]);
  employeeOptions = computed<SelectOption[]>(() => [...new Set(['Stock', ...this.employeeNames()])]
    .map(name => ({ value: name, label: name })));
  activeEmployeeOptions = computed<SelectOption[]>(() => this.data.employeeRoster().map(employee => ({ value: employee.name, label: employee.name })));
  assetModels = computed(() => [...new Set([...Object.values(this.data.catalog()).flat(), ...this.data.assets().map(a => a.name), ...this.data.formerEmployees().flatMap(e => e.assets.map(a => a.name))])]);
  caseModelOptions = () => [
    { value: '', label: 'Select item model...' },
    ...this.assetModels().filter(model => !this.category || this.categoryForModel(model) === this.category).map(model => ({ value: model, label: model }))
  ];
  modelFilterOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'All item models' },
    ...[...new Set(this.data.dellCases().map(row => row.assetModel))].sort().map(model => ({ value: model, label: model }))
  ]);
  categoryForModel(model: string): string {
    for (const [category, models] of Object.entries(this.data.catalog())) if (models.includes(model)) return category;
    return this.data.assets().find(asset => asset.name === model)?.category
      || this.data.formerEmployees().flatMap(employee => employee.assets).find(asset => asset.name === model)?.category
      || '';
  }
  assetSerials = computed(() => [...new Set([...this.data.assets().map(a => a.serial), ...this.data.formerEmployees().flatMap(e => e.assets.map(a => a.serial))])]);
  canAdd = () => this.auth.can('dellCases.add');
  canEdit = () => this.auth.can('dellCases.edit');
  canDelete = () => this.auth.can('dellCases.delete');
  canComment = () => this.auth.can('dellCases.comment');
  canImport = () => this.auth.can('dellCases.import');
  canExport = () => this.auth.can('dellCases.export');
  constructor(public data: DataService, private auth: AuthService, private ui: UiService) {}
  ngOnInit() { void Promise.all([this.data.loadDellCases(), this.data.loadEmployees(), this.data.loadFormerEmployees()]); }
  private matching = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.data.dellCases().filter(row => {
      const category = row.category || this.categoryForModel(row.assetModel);
      return (!this.categoryFilter() || category === this.categoryFilter())
        && (!this.modelFilter() || row.assetModel === this.modelFilter())
        && (!q || `${row.employeeName} ${row.category || category} ${row.assetModel} ${row.assetSerial} ${row.caseId} ${row.registeredBy} ${row.status} ${row.issueDescription}`.toLowerCase().includes(q));
    });
  });
  private sorted = computed(() => {
    const field = this.sortField(); const asc = this.sortAsc();
    return [...this.matching()].sort((a, b) => {
      const left = a[field]; const right = b[field];
      const cmp = field === 'registeredDate'
        ? String(left).localeCompare(String(right))
        : String(left ?? '').toLowerCase().localeCompare(String(right ?? '').toLowerCase());
      return asc ? cmp : -cmp;
    });
  });
  pageResult = computed<PageResult<DellCase>>(() => paginate(this.sorted(), this.page(), this.size()));
  filtered() { return this.pageResult().sliced; }
  onSearch(value: string) { this.search.set(value); this.page.set(1); }
  setCategoryFilter(value: string) { this.categoryFilter.set(value); this.page.set(1); }
  setModelFilter(value: string) { this.modelFilter.set(value); this.page.set(1); }
  setCategory(value: string) { this.category = value; this.assetModel = ''; this.assetSerial = ''; if (value) this.error.set(''); }
  sort(field: keyof DellCase) { if (this.sortField() === field) this.sortAsc.set(!this.sortAsc()); else { this.sortField.set(field); this.sortAsc.set(true); } }
  changeSize(value: string) { this.size.set(value === 'All' ? Infinity : parseInt(value, 10)); this.page.set(1); }
  changePage(delta: number) { this.page.set(this.page() + delta); }
  setEmployeeName(value: string) { this.employeeName = value; if (value.trim()) this.error.set(''); }
  openComments(row: DellCase) { this.commentsCaseId.set(row.id); }
  closeComments() { this.commentsCaseId.set(null); }
  exportExcel() { if (!this.canExport()) return; exportXlsx(this.sorted().map(row => ({ 'Case ID': row.caseId, Employee: row.employeeName, Category: row.category || this.categoryForModel(row.assetModel), 'Item Model / Name': row.assetModel, 'Serial No.': row.assetSerial, Registered: row.registeredDate, Issue: row.issueDescription, 'Registered By': row.registeredBy, Status: row.status })), 'Dell Cases', 'AssetFlow_Dell_Cases.xlsx'); }
  downloadTemplate() { exportXlsx([{ 'Case ID': '123456789', Employee: 'Sarah Johnson', Category: 'Laptop', 'Item Model / Name': 'Dell Latitude 5450', 'Asset Serial No.': 'SN-001', 'Case Registered Date': new Date().toISOString().slice(0, 10), 'Issue Description': 'Screen issue', 'Registered By': 'Admin', Status: 'Unresolved' }], 'Dell Cases Template', 'AssetFlow_Dell_Cases_Template.xlsx'); }
  importExcel(event: Event) { if (!this.canImport()) return; const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return; const limitError = importFileLimitError(file); if (limitError) { this.ui.error(limitError); input.value = ''; return; } const reader = new FileReader(); reader.onload = async e => { try { const wb = XLSX.read(new Uint8Array((e.target as FileReader).result as ArrayBuffer), { type: 'array', cellDates: false, sheetRows: MAX_IMPORT_ROWS + 2 }); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]); if (rows.length > MAX_IMPORT_ROWS) { this.ui.error(`This spreadsheet has more than ${MAX_IMPORT_ROWS} rows. Split it into smaller files and try again.`); return; } if (!await this.ui.confirmImport(rows.length, 'Dell case')) return; const result = await this.data.importDellCases(rows); this.ui.success(`Imported ${result.imported} Dell case(s).`); if (result.skipped) this.ui.error(`Skipped ${result.skipped}:\\n- ${result.errors.slice(0, 8).join('\\n- ')}`, 8000); } catch { this.ui.error('Could not parse or import this file. Use the Dell Cases template.'); } finally { input.value = ''; } }; reader.readAsArrayBuffer(file); }
  openAdd() {
    if (!this.canAdd()) return;
    this.reset(); const now = new Date(); this.registeredDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const user = this.auth.currentUser();
    this.registeredBy = user?.displayName?.trim() && user.displayName.trim() !== user.username ? user.displayName.trim() : '';
    this.formOpen.set(true);
  }
  edit(row: DellCase) {
    if (!this.canEdit()) return;
    this.editingId.set(row.id); this.employeeName = row.employeeName; this.category = row.category || this.categoryForModel(row.assetModel); this.assetModel = row.assetModel; this.assetSerial = row.assetSerial;
    this.registeredDate = row.registeredDate; this.caseId = row.caseId; this.issueDescription = row.issueDescription;
    this.registeredBy = row.registeredBy; this.status = row.status;
    this.error.set(''); this.formOpen.set(true);
  }
  reset() { this.editingId.set(null); this.employeeName = 'Stock'; this.category = ''; this.assetModel = ''; this.assetSerial = ''; this.registeredDate = ''; this.caseId = ''; this.issueDescription = ''; this.registeredBy = ''; this.status = 'Unresolved'; this.error.set(''); }
  setStatus(value: string) { this.status = value; }
  close() { this.formOpen.set(false); this.reset(); }
  async save(event: Event) {
    event.preventDefault(); if ((this.editingId() == null ? !this.canAdd() : !this.canEdit()) || this.saving()) return;
    if (!this.employeeName.trim()) { this.error.set('Select an employee.'); return; }
    if (!this.category || !this.assetModel) { this.error.set('Select a category and item model.'); return; }
    const serial = this.assetSerial.trim().toLowerCase();
    const trackedAsset = [...this.data.assets(), ...this.data.formerEmployees().flatMap(employee => employee.assets)]
      .find(asset => asset.serial.trim().toLowerCase() === serial);
    if (trackedAsset && (trackedAsset.category !== this.category || trackedAsset.name.toLowerCase() !== this.assetModel.trim().toLowerCase())) {
      this.error.set(`Serial ${trackedAsset.serial} belongs to ${trackedAsset.name} (${trackedAsset.category}), not the selected model and category.`); return;
    }
    if (this.data.dellCases().some(row => row.id !== this.editingId() && row.caseId.trim().toLowerCase() === this.caseId.trim().toLowerCase())) { this.error.set(`Case ID ${this.caseId.trim()} already exists.`); return; }
    if (trackedAsset && trackedAsset.assignedTo && trackedAsset.assignedTo.toLowerCase() !== 'stock' && trackedAsset.assignedTo.toLowerCase() !== this.employeeName.trim().toLowerCase()) {
      const ok = await this.ui.confirm({ title: 'Employee differs from asset assignment', message: `Serial ${trackedAsset.serial} is currently assigned to ${trackedAsset.assignedTo}, but this case is for ${this.employeeName}. Save the case with this employee anyway?`, confirmLabel: 'Save case' });
      if (!ok) return;
    }
    this.saving.set(true); this.error.set('');
    const result = await this.data.saveDellCase({ ...(this.editingId() == null ? {} : { id: this.editingId()! }), employeeName: this.employeeName.trim(), category: this.category, assetModel: this.assetModel.trim(), assetSerial: this.assetSerial.trim(), registeredDate: this.registeredDate, caseId: this.caseId.trim(), issueDescription: this.issueDescription.trim(), registeredBy: this.registeredBy.trim(), status: this.status as DellCase['status'] });
    this.saving.set(false);
    if (!result.ok) { this.error.set(result.error || 'Could not save the Dell case.'); return; }
    this.ui.success(this.editingId() == null ? 'Dell case registered.' : 'Dell case updated.'); this.close();
  }
  async remove(row: DellCase) {
    if (!this.canDelete()) return;
    const ok = await this.ui.confirm({ title: 'Delete Dell case', message: `Delete case ${row.caseId}? This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const result = await this.data.deleteDellCase(row.id);
    if (!result.ok) this.ui.error(result.error || 'Could not delete the case.'); else this.ui.success(`Case ${row.caseId} deleted.`);
  }
  date(value: string) { return new Date(`${value}T00:00:00`).toLocaleDateString(); }
  statusClass(status: string) { return status === 'Resolved' ? 'bg-emerald-500/10 text-emerald-500' : status === 'Unresolved' ? 'bg-amber-500/10 text-amber-500' : 'bg-slate-500/10 text-slate-500'; }
}
