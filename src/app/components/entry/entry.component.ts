import { Component, computed, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';
import { AuthService } from '../../services/auth.service';
import { UiService } from '../../services/ui.service';
import { CustomSelectComponent } from '../shared/custom-select.component';
import { AutocompleteComponent } from '../shared/autocomplete.component';
import { CommentsModalComponent } from '../shared/comments-modal.component';
import { DellCasePopupComponent } from '../shared/dell-case-popup.component';
import { AssignModalComponent } from '../shared/assign-modal.component';
import { EmojiPickerComponent } from '../shared/emoji-picker.component';
import { Asset, AssetAssignmentType, HistoryEntry, SelectOption } from '../../models/models';
import { MAX_IMPORT_ROWS, PageResult, categoryIcon, exportXlsx, importFileLimitError, pageInfo, paginate, statusBadge } from '../../services/util';

@Component({
  selector: 'app-entry',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CustomSelectComponent, AutocompleteComponent, CommentsModalComponent, DellCasePopupComponent, AssignModalComponent, EmojiPickerComponent],
  templateUrl: './entry.component.html'
})
export class EntryComponent implements OnDestroy {
  categoryIcon = categoryIcon;
  statusBadge = statusBadge;
  pageInfo = pageInfo;
  Infinity = Infinity;

  categoryOptions = computed<SelectOption[]>(() => this.data.categories().map(c => ({ value: c, label: c })));
  statusOptions: SelectOption[] = [];
  assignmentTypeOptions: SelectOption[] = [{ value: 'Primary', label: 'Primary' }, { value: 'Temporary', label: 'Temporary' }];
  bulkOptions: SelectOption[] = [];
  catFilterOptions = computed<SelectOption[]>(() => [{ value: 'All', label: 'All Categories' }, ...this.data.categories().map(c => ({ value: c, label: c }))]);
  deptFilterOptions: SelectOption[] = [];
  sizeOptions: SelectOption[] = [{ value: '10', label: '10' }, { value: '20', label: '20' }, { value: '50', label: '50' }, { value: '100', label: '100' }];

  // form model
  fCategory = signal('Laptop');
  fModel = signal('');
  fDepartment = signal('Stock');
  fStatus = signal('In Storage');
  fSerial = '';
  fAssignmentType = signal<AssetAssignmentType>('Primary');
  fAssignedTo = signal('');
  fComment = signal('');

  modelOptions = computed<SelectOption[]>(() => (this.data.catalog()[this.fCategory()] || []).map(m => ({ value: m, label: m })));
  assignableEmployees = computed<string[]>(() => [...this.data.employeeRoster().map(employee => employee.name), 'Stock']);

  // confirm modal
  confirmOpen = signal(false);
  archiveOpen = signal(false);
  archiveLoading = signal(false);
  archiveError = signal('');
  restoringRecord = signal<number | null>(null);
  assignmentWarnings = signal<string[]>([]);
  // add-equipment modal (the registration form opens in a popup)
  addOpen = signal(false);
  pending: Asset | null = null;
  formError = signal('');
  saving = signal(false);
  serialTouched = signal(false);
  scanOpen = signal(false);
  scanError = signal('');
  scanStream: MediaStream | null = null;
  private scanFrame = 0;
  private scanVideo: HTMLVideoElement | null = null;
  private scanDetector: any = null;

  // registered table
  page = signal(1);
  size = signal<number>(10);
  selected = signal<Set<number>>(new Set());
  bulkStatus = signal('');

  // table search / filters
  search = signal('');
  catFilter = signal('All');
  deptFilter = signal('All');
  statusFilter = signal('All');
  hasFilters = computed(() => !!this.search().trim() || this.catFilter() !== 'All' || this.deptFilter() !== 'All' || this.statusFilter() !== 'All');
  statusCounts = computed(() => {
    const assets = this.data.assets();
    return {
      'In Storage': assets.filter(asset => asset.status === 'In Storage').length,
      'In Use': assets.filter(asset => asset.status === 'In Use').length,
      'Under Repair': assets.filter(asset => asset.status === 'Under Repair').length
    };
  });

  // edit modal
  editOpen = signal(false);
  modalError = signal('');
  modalSaving = signal(false);
  eId = 0;
  eCategory = signal('Laptop');
  eName = signal('');
  eDepartment = signal('IT');
  eStatus = signal('In Use');
  eSerial = '';
  eAssignmentType = signal<AssetAssignmentType>('Primary');
  eAssignedTo = signal('');
  ePurchaseDate = '';
  eWarrantyDate = '';
  editModelOptions = computed<SelectOption[]>(() => (this.data.catalog()[this.eCategory()] || []).map(m => ({ value: m, label: m })));

  // history modal — tracks the asset by id so the timeline stays live across reloads
  historyOpen = signal(false);
  historyId = signal<number | null>(null);
  historyAsset = computed<Asset | null>(() => {
    const id = this.historyId();
    return id == null ? null : (this.data.assets().find(a => a.id === id) ?? null);
  });
  historyEntries = computed<HistoryEntry[]>(() =>
    [...(this.historyAsset()?.history ?? [])].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
  );

  // comments popup — tracks the asset by id; the shared modal reads live comments
  commentsId = signal<number | null>(null);
  linkedDellCaseId = signal<number | null>(null);
  linkedDellCaseAsset = signal<Asset | null>(null);
  openComments(a: Asset) { this.commentsId.set(a.id); }
  closeComments() { this.commentsId.set(null); }
  openDellCase(caseId: number | null, event: Event) { event.stopPropagation(); if (caseId != null) this.linkedDellCaseId.set(caseId); }
  openDellCaseForAsset(asset: Asset, event: Event) { event.stopPropagation(); this.linkedDellCaseId.set(null); this.linkedDellCaseAsset.set(asset); }
  closeDellCase() { this.linkedDellCaseId.set(null); this.linkedDellCaseAsset.set(null); }

  // check-in / check-out popup (shared assign modal), tracked by asset id
  assignId = signal<number | null>(null);
  openAssign(a: Asset) { if (this.canAssign) this.assignId.set(a.id); }
  closeAssign() { this.assignId.set(null); }

  private filtered = computed<Asset[]>(() => {
    const q = this.search().toLowerCase().trim();
    const cf = this.catFilter();
    const df = this.deptFilter();
    const sf = this.statusFilter();
    return this.data.assets().filter(item => {
      const matchesQuery = !q || item.name.toLowerCase().includes(q) || item.serial.toLowerCase().includes(q) || (!!item.assignedTo && item.assignedTo.toLowerCase().includes(q));
      const matchesCat = cf === 'All' || item.category === cf;
      const matchesDept = df === 'All' || (item.department || 'IT') === df;
      const matchesStatus = sf === 'All' || item.status === sf;
      return matchesQuery && matchesCat && matchesDept && matchesStatus;
    });
  });

  pageResult = computed<PageResult<Asset>>(() => paginate(this.sorted(), this.page(), this.size()));

  // ---- Sorting ----
  sortField = signal<string>('name');
  sortAsc = signal(true);
  private sorted = computed<Asset[]>(() => {
    const field = this.sortField();
    const asc = this.sortAsc();
    return [...this.filtered()].sort((a, b) => {
      const valA = ((a as any)[field] || '').toString().toLowerCase();
      const valB = ((b as any)[field] || '').toString().toLowerCase();
      return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  });

  sort(field: string) {
    if (this.sortField() === field) this.sortAsc.set(!this.sortAsc());
    else { this.sortField.set(field); this.sortAsc.set(true); }
  }

  toggleStatusFilter(status: string) {
    this.statusFilter.set(this.statusFilter() === status ? 'All' : status);
    this.page.set(1);
    this.selected.set(new Set());
  }

  constructor(public data: DataService, public auth: AuthService, private ui: UiService) {
    void this.data.loadDellCases();
    void this.data.loadEmployees();
    this.statusOptions = this.data.statuses.map(s => ({ value: s, label: s }));
    this.bulkOptions = [{ value: '', label: 'Update Status...' }, ...this.data.statuses.map(s => ({ value: s, label: s }))];
    this.deptFilterOptions = [{ value: 'All', label: 'All Departments' }, ...[...this.data.departments, 'Stock'].map(d => ({ value: d, label: d }))];
    // initialize model to first of category
    const first = this.modelOptions()[0];
    if (first) this.fModel.set(first.value);
  }

  onCategoryChange(v: string) {
    this.fCategory.set(v);
    const first = this.modelOptions()[0];
    this.fModel.set(first ? first.value : '');
    this.formError.set('');
  }

  onEntryStatusChange(status: string) {
    this.fStatus.set(status);
  }

  onEntryAssignedChange(assignedTo: string) {
    this.fAssignedTo.set(assignedTo);
    this.fDepartment.set(this.departmentFor(assignedTo));
    const assignee = assignedTo.trim().toLowerCase();
    this.fStatus.set(!assignee || ['stock', 'unassigned'].includes(assignee) ? 'In Storage' : 'In Use');
    this.formError.set('');
  }

  setFormAssignmentType(value: string) { this.fAssignmentType.set(value === 'Temporary' ? 'Temporary' : 'Primary'); this.formError.set(''); }
  setEditAssignmentType(value: string) { this.eAssignmentType.set(value === 'Temporary' ? 'Temporary' : 'Primary'); }

  onEditStatusChange(status: string) {
    this.eStatus.set(status);
  }

  onEditAssignedChange(assignedTo: string) {
    this.eAssignedTo.set(assignedTo);
    this.eDepartment.set(this.departmentFor(assignedTo));
    const assignee = assignedTo.trim().toLowerCase();
    this.eStatus.set(!assignee || ['stock', 'unassigned'].includes(assignee) ? 'In Storage' : 'In Use');
  }

  private departmentFor(assignedTo: string): string {
    const assignee = assignedTo.trim();
    if (!assignee || ['stock', 'unassigned'].includes(assignee.toLowerCase())) return 'Stock';
    const employee = this.data.employeeRoster().find(item => item.name.trim().toLowerCase() === assignee.toLowerCase());
    return employee?.department?.trim() || 'IT';
  }

  submit(event: Event) {
    event.preventDefault();
    if (!this.auth.can('assets.add')) return;
    this.serialTouched.set(true);
    const err = this.validate();
    // Validation is already presented beside the relevant input; don't repeat
    // that same message in the form-level API error banner.
    if (err) { this.formError.set(''); return; }
    this.formError.set('');
    this.fDepartment.set(this.departmentFor(this.fAssignedTo()));
    this.pending = {
      id: Date.now(),
      category: this.fCategory(),
      name: this.fModel().trim(),
      department: this.fDepartment(),
      serial: this.fSerial.trim(),
      assignmentType: this.fAssignmentType(),
      assignedTo: this.fAssignedTo().trim() || 'Stock',
      status: this.fStatus(),
      purchaseDate: '',
      warrantyDate: ''
    };
    this.assignmentWarnings.set(this.getAssignmentWarnings(this.pending));
    this.confirmOpen.set(true);
  }

  primaryAssetConflicts(assignedTo: string, category: string, excludedId?: number): Asset[] {
    const employee = assignedTo.trim().toLowerCase();
    const assetCategory = category.trim().toLowerCase();
    if (!employee || ['stock', 'unassigned'].includes(employee) || !assetCategory) return [];
    return this.data.assets().filter(asset => asset.id !== excludedId &&
      asset.category.trim().toLowerCase() === assetCategory &&
      asset.assignedTo.trim().toLowerCase() === employee &&
      (asset.assignmentType || 'Primary').trim().toLowerCase() === 'primary'
    );
  }

  private isStockAssignee(value: string | undefined): boolean {
    return !value?.trim() || ['stock', 'unassigned'].includes(value.trim().toLowerCase());
  }

  private getAssignmentWarnings(asset: Asset): string[] {
    const employee = asset.assignedTo.trim();
    if (this.isStockAssignee(employee)) return [];
    const matchingCategory = this.data.assets().filter(existing =>
      existing.category.trim().toLowerCase() === asset.category.trim().toLowerCase() &&
      existing.serial.trim().toLowerCase() !== asset.serial.trim().toLowerCase() &&
      !this.isStockAssignee(existing.assignedTo)
    );
    const sameEmployee = matchingCategory.filter(existing => existing.assignedTo.trim().toLowerCase() === employee.toLowerCase());
    const sameModelForEmployee = sameEmployee.filter(existing => existing.name.trim().toLowerCase() === asset.name.trim().toLowerCase());
    const warnings: string[] = [];

    if (sameModelForEmployee.length) {
      const registered = sameModelForEmployee.map(existing => `${existing.name} (${existing.serial})`).join(', ');
      warnings.push(`Possible duplicate: ${employee} already has this ${asset.category} model registered (${registered}). Confirm this is a separate unit before adding another.`);
    } else if (sameEmployee.length) {
      const registered = sameEmployee.map(existing => `${existing.name} (${existing.serial})`).join(', ');
      warnings.push(`${employee} already has ${asset.category} equipment (${registered}). This entry has a different model; confirm the additional assignment is intended.`);
    }

    const sameModelForOthers = matchingCategory.filter(existing =>
      existing.name.trim().toLowerCase() === asset.name.trim().toLowerCase() &&
      existing.assignedTo.trim().toLowerCase() !== employee.toLowerCase()
    );
    if (sameModelForOthers.length) {
      const owners = [...new Set(sameModelForOthers.map(existing => `${existing.assignedTo} (${existing.serial})`))].join(', ');
      warnings.push(`This ${asset.category} model is already assigned to ${owners}. Confirm the new serial belongs to a separate unit.`);
    }
    return warnings;
  }

  /** Client-side validation for fast feedback; the server re-validates every field.
   *  Purchase/warranty dates are intentionally NOT collected here — they are managed
   *  separately in the Warranty & Predictive Forecasting module (via its import). */
  private validate(): string {
    if (!this.fModel().trim()) return 'Please select or enter a model.';
    if (!this.fSerial.trim()) return 'Serial number is required.';
    const serial = this.fSerial.trim().toLowerCase();
    if (this.data.assets().some(a => a.serial.toLowerCase() === serial)) return `An asset with serial "${this.fSerial.trim()}" already exists.`;
    if (this.fAssignedTo().trim() && !this.assignableEmployees().some(name => name.toLowerCase() === this.fAssignedTo().trim().toLowerCase())) return 'Select an employee from Manage Employees or choose Stock.';
    return '';
  }

  serialDuplicate(): boolean {
    const serial = this.fSerial.trim().toLowerCase();
    return !!serial && this.data.assets().some(a => a.serial.trim().toLowerCase() === serial);
  }

  async startSerialScan(video: HTMLVideoElement) {
    this.scanError.set('');
    if (!('BarcodeDetector' in window)) {
      this.scanError.set('Barcode scanning is not supported by this browser. Enter the serial number manually.');
      this.scanOpen.set(true);
      return;
    }
    try {
      this.scanDetector = new (window as any).BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e'] });
      this.scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      this.scanVideo = video;
      video.srcObject = this.scanStream;
      await video.play();
      this.scanOpen.set(true);
      this.scanFrame = requestAnimationFrame(() => this.readSerialFrame());
    } catch {
      this.scanError.set('Camera access is unavailable. Allow camera access or enter the serial number manually.');
      this.scanOpen.set(true);
      this.stopSerialScan(false);
    }
  }

  private async readSerialFrame() {
    if (!this.scanOpen() || !this.scanVideo || !this.scanDetector) return;
    try {
      const codes = await this.scanDetector.detect(this.scanVideo);
      const value = codes?.[0]?.rawValue?.trim();
      if (value) {
        this.fSerial = value;
        this.serialTouched.set(true);
        this.stopSerialScan();
        return;
      }
    } catch { /* continue scanning; some frames may not decode */ }
    this.scanFrame = requestAnimationFrame(() => this.readSerialFrame());
  }

  stopSerialScan(close = true) {
    if (this.scanFrame) cancelAnimationFrame(this.scanFrame);
    this.scanFrame = 0;
    this.scanStream?.getTracks().forEach(track => track.stop());
    this.scanStream = null;
    if (this.scanVideo) this.scanVideo.srcObject = null;
    this.scanVideo = null;
    if (close) this.scanOpen.set(false);
  }

  ngOnDestroy() { this.stopSerialScan(); }

  closeConfirm() { this.confirmOpen.set(false); this.pending = null; this.assignmentWarnings.set([]); }

  /** Reset the registration form fields to their defaults. */
  private resetAddForm() {
    this.fCategory.set('Laptop');
    const first = this.modelOptions()[0];
    this.fModel.set(first ? first.value : '');
    this.fDepartment.set('Stock');
    this.fStatus.set('In Storage');
    this.fSerial = '';
    this.fAssignmentType.set('Primary');
    this.fAssignedTo.set('');
    this.fComment.set('');
    this.serialTouched.set(false);
    this.formError.set('');
  }

  openAdd() {
    if (!this.auth.can('assets.add')) return;
    this.resetAddForm();
    this.addOpen.set(true);
  }
  closeAdd() { this.addOpen.set(false); this.formError.set(''); }

  async confirmSave() {
    if (!this.pending || this.saving()) return;
    if (!this.auth.can('assets.add')) return;
    const pending = this.pending;
    this.saving.set(true);
    const comment = this.fComment().trim();
    const res = await this.data.addAsset({ ...pending, ...(comment ? { comment } : {}), allowDuplicateAssignment: this.assignmentWarnings().length > 0 });
    this.saving.set(false);
    if (!res.ok) {
      await this.data.loadAssets();
      this.formError.set(this.serialDuplicate() ? `Serial number "${pending.serial}" is already registered.` : (res.error || 'Could not save the asset.'));
      this.serialTouched.set(true);
      this.closeConfirm();
      return;
    }
    this.ui.success(`Registered "${pending.name}" (${pending.serial}).`);
    this.resetAddForm();
    this.closeConfirm();
    this.closeAdd();
  }

  // table
  onSearch() { this.page.set(1); this.selected.set(new Set()); }
  onFilter() { this.page.set(1); this.selected.set(new Set()); }
  changeSize(v: string) { this.size.set(v === 'All' ? Infinity : parseInt(v, 10)); this.page.set(1); }
  changePage(delta: number) { this.page.set(this.page() + delta); }

  get canSelect() { return this.auth.canAny('assets.edit', 'assets.delete'); }
  get canEdit() { return this.auth.can('assets.edit'); }
  get canAdd() { return this.auth.can('assets.add'); }
  get canAssign() { return this.auth.can('assets.assign'); }
  get canDelete() { return this.auth.can('assets.delete'); }
  get canImport() { return this.auth.can('assets.import'); }
  get canExport() { return this.auth.can('assets.export'); }
  get canManageArchive() { return this.auth.isAdmin(); }

  /** Download a blank asset sheet to fill in and re-import. Dates are omitted —
   *  they are managed separately in the Warranty & Predictive Forecasting module. */
  downloadTemplate() {
    const sample = [{ 'Item Name': 'Dell Latitude 5450', 'Category': 'Laptop', 'Department': 'IT', 'Serial Number': 'SN-001', 'Assignment Type': 'Primary', 'Assigned To': 'Sarah', 'Status': 'In Use' }];
    exportXlsx(sample, 'Template', 'AssetFlow_Template.xlsx');
  }

  /** Export the currently listed equipment (honors the active search/filters) to Excel. */
  exportExcel() {
    const rows = this.filtered().map(a => ({
      'Item Name': a.name,
      'Category': a.category,
      'Department': a.department || 'IT',
      'Serial Number': a.serial,
      'Assignment Type': a.assignmentType || 'Primary',
      'Assigned To': a.assignedTo || 'Stock',
      'Status': a.status
    }));
    if (rows.length === 0) { this.ui.error('Nothing to export for the current filters.'); return; }
    exportXlsx(rows, 'Assets', 'AssetFlow_Assets.xlsx');
  }

  /** Import assets in bulk from an Excel/CSV file (server-routed, validated). */
  importExcel(event: Event) {
    if (!this.canImport) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const limitError = importFileLimitError(file);
    if (limitError) { this.ui.error(limitError); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const dataArr = new Uint8Array((e.target as FileReader).result as ArrayBuffer);
        const workbook = XLSX.read(dataArr, { type: 'array', sheetRows: MAX_IMPORT_ROWS + 2 });
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        if (rows.length > MAX_IMPORT_ROWS) { this.ui.error(`This spreadsheet has more than ${MAX_IMPORT_ROWS} rows. Split it into smaller files and try again.`); return; }
        if (!await this.ui.confirmImport(rows.length, 'asset')) return;
        const res = await this.data.importAssets(rows);
        this.ui.success(`Imported ${res.imported} item(s).`);
        if (res.skipped) {
          this.ui.error(`Skipped ${res.skipped}:\n- ${res.errors.slice(0, 8).join('\n- ')}`, 8000);
        }
      } catch {
        this.ui.error('Error parsing or importing the Excel file.');
      } finally {
        input.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }
  isSelected(id: number) { return this.selected().has(id); }
  toggleRow(id: number, checked: boolean) {
    const next = new Set(this.selected());
    if (checked) next.add(id); else next.delete(id);
    this.selected.set(next);
  }
  toggleAll(checked: boolean) {
    const next = new Set(this.selected());
    for (const item of this.pageResult().sliced) { if (checked) next.add(item.id); else next.delete(item.id); }
    this.selected.set(next);
  }
  async applyBulkStatus() {
    if (!this.auth.can('assets.edit')) return;
    if (!this.bulkStatus()) { this.ui.error('Select a status to apply.'); return; }
    const selected = this.selected();
    if (!selected.size) { this.ui.error('Select at least one asset.'); return; }
    const incompatible = this.data.assets().filter(asset => selected.has(asset.id) && (
      (this.bulkStatus() === 'In Use' && ['stock', 'unassigned', ''].includes((asset.assignedTo || '').trim().toLowerCase())) ||
      (this.bulkStatus() === 'In Storage' && !['stock', 'unassigned', ''].includes((asset.assignedTo || '').trim().toLowerCase()))
    ));
    if (incompatible.length) {
      this.ui.error(`Cannot set ${this.bulkStatus()} for ${incompatible.length} selected asset(s): assignment must match the status.`);
      return;
    }
    const ok = await this.ui.confirm({ title: 'Update asset statuses', message: `Set ${this.selected().size} selected asset(s) to ${this.bulkStatus()}?`, confirmLabel: 'Update status' });
    if (!ok) return;
    const result = await this.data.bulkUpdateStatus(selected, this.bulkStatus());
    if (!result.ok) { this.ui.error(result.error || 'Could not update asset statuses.'); return; }
    this.selected.set(new Set());
    this.bulkStatus.set('');
    this.ui.success(`Updated status for ${result.count ?? 0} item(s).`);
  }

  // ---- Edit modal ----
  openEdit(a: Asset) {
    if (!this.auth.can('assets.edit')) return;
    if (!this.canEdit) return;
    this.eId = a.id;
    this.eCategory.set(a.category);
    this.eName.set(a.name);
    this.eStatus.set(a.status);
    this.eSerial = a.serial;
    this.eAssignmentType.set(a.assignmentType || 'Primary');
    this.eAssignedTo.set(a.assignedTo && a.assignedTo !== 'Stock' ? a.assignedTo : '');
    this.eDepartment.set(this.departmentFor(this.eAssignedTo()));
    this.ePurchaseDate = a.purchaseDate;
    this.eWarrantyDate = a.warrantyDate;
    this.modalError.set('');
    this.editOpen.set(true);
  }

  onEditCategoryChange(v: string) {
    this.eCategory.set(v);
    const first = this.editModelOptions()[0];
    this.eName.set(first ? first.value : '');
  }

  closeEditModal() { this.editOpen.set(false); this.modalError.set(''); }

  async saveEdit() {
    if (this.modalSaving()) return;
    const name = this.eName().trim();
    const serial = this.eSerial.trim();
    if (!name) { this.modalError.set('Item name is required.'); return; }
    if (!serial) { this.modalError.set('Serial number is required.'); return; }
    if (this.eAssignedTo().trim() && !this.assignableEmployees().some(employee => employee.toLowerCase() === this.eAssignedTo().trim().toLowerCase())) { this.modalError.set('Select an employee from Manage Employees or choose Stock.'); return; }
    if (this.ePurchaseDate && this.eWarrantyDate && this.eWarrantyDate < this.ePurchaseDate) { this.modalError.set('Warranty date cannot be earlier than the purchase date.'); return; }
    if (this.data.assets().some(a => a.id !== this.eId && a.serial.toLowerCase() === serial.toLowerCase())) {
      this.modalError.set(`Another asset already uses serial "${serial}".`); return;
    }
    this.eDepartment.set(this.departmentFor(this.eAssignedTo()));
    this.modalSaving.set(true);
    const res = await this.data.updateAsset(this.eId, {
      category: this.eCategory(), name, department: this.eDepartment(), serial, assignmentType: this.eAssignmentType(),
      assignedTo: this.eAssignedTo().trim() || 'Stock', status: this.eStatus(),
      purchaseDate: this.ePurchaseDate, warrantyDate: this.eWarrantyDate
    });
    this.modalSaving.set(false);
    if (!res.ok) { this.modalError.set(res.error || 'Could not update the asset.'); return; }
    this.ui.success(`Updated "${name}" (${serial}).`);
    this.closeEditModal();
  }

  async bulkDelete() {
    if (!this.auth.can('assets.delete')) return;
    const ok = await this.ui.confirm({ title: 'Move assets to recovery archive', message: `Move ${this.selected().size} selected item(s) to the admin recovery archive? They can be restored later.`, confirmLabel: 'Move to archive', danger: true });
    if (!ok) return;
    const count = await this.data.bulkDelete(this.selected());
    this.selected.set(new Set());
    this.ui.success(`Moved ${count} item(s) to the recovery archive.`);
  }

  async openRecoveryArchive() {
    this.archiveOpen.set(true); this.archiveLoading.set(true); this.archiveError.set('');
    try { await this.data.loadRecoveryArchive(); }
    catch (error) { this.archiveError.set(error instanceof Error ? error.message : 'Could not load the recovery archive.'); }
    finally { this.archiveLoading.set(false); }
  }

  async restoreArchived(row: { id: number; type: string; record: any }) {
    if (!this.auth.isAdmin()) return;
    this.restoringRecord.set(row.id);
    const result = await this.data.restoreArchivedRecord(row.id);
    this.restoringRecord.set(null);
    if (!result.ok) { this.archiveError.set(result.error || 'Could not restore the record.'); return; }
    this.ui.success(`${this.archiveRecordName(row)} restored. The audit log records who restored it.`);
  }
  archiveRecordName(row: { type: string; record: any }): string {
    if (row.type === 'deskPeripheral') return `${row.record.category} at ${row.record.deskNo}`;
    if (row.type === 'dellCase') return `Dell case ${row.record.caseId}`;
    return row.type === 'quickLink' ? row.record.name : row.record.name;
  }
  async deleteAsset(id: number) {
    if (!this.auth.can('assets.delete')) return;
    const asset = this.data.assets().find(a => a.id === id);
    const label = asset ? `"${asset.name}" (${asset.serial})` : 'this asset';
    const ok = await this.ui.confirm({ title: 'Move asset to recovery archive', message: `Move ${label} to the admin recovery archive? It can be restored later.`, confirmLabel: 'Move to archive', danger: true });
    if (!ok) return;
    const res = await this.data.deleteAsset(id);
    if (!res.ok) this.ui.error(res.error || 'Could not delete the asset.');
    else this.ui.success('Asset moved to the recovery archive.');
  }

  // ---- History timeline ----
  openHistory(a: Asset) { this.historyId.set(a.id); this.historyOpen.set(true); }
  closeHistory() { this.historyOpen.set(false); this.historyId.set(null); }

  /** Friendly local date/time for a history entry's ISO timestamp. */
  historyTime(ts: string): string {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /** Font Awesome icon + accent color for a timeline entry, chosen from its text. */
  historyIcon(action: string): string {
    const a = (action || '').toLowerCase();
    if (a.startsWith('registered')) return 'fa-circle-plus text-indigo-400';
    if (a.startsWith('status')) return 'fa-arrows-rotate text-blue-400';
    if (a.includes('checked in') || a.includes('checked out') || a.startsWith('assigned') || a.includes('returned')) return 'fa-user-tag text-purple-400';
    if (a.includes('comment')) return 'fa-comment text-violet-400';
    if (a.includes('warranty') || a.includes('purchase')) return 'fa-shield-halved text-emerald-400';
    return 'fa-pen text-amber-400';
  }
}
