import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { DataService } from '../../services/data.service';
import { UiService } from '../../services/ui.service';
import { DeskPeripheral, SelectOption } from '../../models/models';
import { CustomSelectComponent } from '../shared/custom-select.component';
import { MAX_IMPORT_ROWS, PageResult, exportXlsx, importFileLimitError, pageInfo, paginate } from '../../services/util';

@Component({
  selector: 'app-desk-setup',
  standalone: true,
  imports: [CommonModule, FormsModule, CustomSelectComponent],
  templateUrl: './desk-setup.component.html'
})
export class DeskSetupComponent implements OnInit {
  pageInfo = pageInfo;
  Infinity = Infinity;

  // ---- Add / edit modal ----
  formOpen = signal(false);
  editingId = signal<number | null>(null);
  saving = signal(false);
  error = signal('');
  deskNo = '';
  category = '';
  model = '';
  serial = '';

  /** Only fixed desk equipment is tracked here. */
  readonly deskCategories = this.data.deskCategories;
  /** Category options for the add/edit dropdown (first entry acts as a placeholder). */
  readonly categoryOptions = computed<SelectOption[]>(() => [{ value: '', label: 'Select category' }, ...this.deskCategories().map(c => ({ value: c, label: c }))]);
  /** Category options for the table filter (All + each category). */
  readonly catFilterOptions = computed<SelectOption[]>(() => [{ value: 'All', label: 'All Categories' }, ...this.deskCategories().map(c => ({ value: c, label: c }))]);
  readonly sizeOptions: SelectOption[] = [
    { value: '10', label: '10' }, { value: '20', label: '20' },
    { value: '50', label: '50' }, { value: '100', label: '100' }, { value: 'All', label: 'All' }
  ];
  /** Item-model options for the add/edit dropdown, driven by the chosen category. */
  modelOptions(): SelectOption[] {
    if (!this.category) return [{ value: '', label: 'Select a category first' }];
    const models = this.data.catalog()[this.category] || [];
    return [{ value: '', label: 'Select item model' }, ...models.map(m => ({ value: m, label: m }))];
  }
  canView = () => this.auth.can('deskSetup.view');
  canAdd = () => this.auth.can('deskSetup.add');
  canEdit = () => this.auth.can('deskSetup.edit');
  canDelete = () => this.auth.can('deskSetup.delete');
  canImport = () => this.auth.can('deskSetup.import');
  canExport = () => this.auth.can('deskSetup.export');

  // ---- Table search / filter / sort / pagination ----
  search = signal('');
  catFilter = signal('All');
  sortField = signal<string>('deskNo');
  sortAsc = signal(true);
  page = signal(1);
  size = signal<number>(10);
  hasFilters = computed(() => !!this.search().trim() || this.catFilter() !== 'All');

  private filtered = computed<DeskPeripheral[]>(() => {
    const q = this.search().toLowerCase().trim();
    const cf = this.catFilter();
    return this.data.deskPeripherals().filter(row => {
      const matchesQuery = !q
        || row.serial.toLowerCase().includes(q)
        || row.model.toLowerCase().includes(q)
        || row.deskNo.toLowerCase().includes(q);
      const matchesCat = cf === 'All' || row.category === cf;
      return matchesQuery && matchesCat;
    });
  });

  private sorted = computed<DeskPeripheral[]>(() => {
    const field = this.sortField();
    const asc = this.sortAsc();
    return [...this.filtered()].sort((a, b) => {
      const valA = ((a as any)[field] || '').toString().toLowerCase();
      const valB = ((b as any)[field] || '').toString().toLowerCase();
      return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  });

  pageResult = computed<PageResult<DeskPeripheral>>(() => paginate(this.sorted(), this.page(), this.size()));

  constructor(public data: DataService, private auth: AuthService, private ui: UiService) {}

  ngOnInit() {
    this.data.loadDeskPeripherals();
    if (!this.data.assets().length) this.data.loadAssets();
  }

  onCategoryChange(category: string) { this.category = category; this.model = ''; }

  sort(field: string) {
    if (this.sortField() === field) this.sortAsc.set(!this.sortAsc());
    else { this.sortField.set(field); this.sortAsc.set(true); }
  }
  onSearch() { this.page.set(1); }
  onFilter() { this.page.set(1); }
  changeSize(v: string) { this.size.set(v === 'All' ? Infinity : parseInt(v, 10)); this.page.set(1); }
  changePage(delta: number) { this.page.set(this.page() + delta); }

  /** Download a blank desk-setup sheet to fill in and re-import. */
  downloadTemplate() {
    const sample = [{ 'Desk No.': 'Desk 104', 'Category': 'Monitor', 'Item Model': 'Dell UltraSharp 27" 4K', 'Serial Number': 'MON-0001' }];
    exportXlsx(sample, 'Template', 'AssetFlow_DeskSetup_Template.xlsx');
  }

  /** Export the currently listed desk setups (honors the active search/filter) to Excel. */
  exportExcel() {
    const rows = this.filtered().map(r => ({
      'Desk No.': r.deskNo,
      'Category': r.category,
      'Item Model': r.model,
      'Serial Number': r.serial
    }));
    if (rows.length === 0) { this.ui.error('Nothing to export for the current filters.'); return; }
    exportXlsx(rows, 'Desk Setups', 'AssetFlow_DeskSetups.xlsx');
  }

  /** Import desk setups in bulk from an Excel/CSV file (server-routed, validated). */
  importExcel(event: Event) {
    if (!this.canImport()) return;
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
        if (!await this.ui.confirmImport(rows.length, 'desk setup')) return;
        const res = await this.data.importDeskPeripherals(rows);
        this.ui.success(`Imported ${res.imported} desk item(s).`);
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

  openAdd() {
    if (!this.canAdd()) return;
    this.editingId.set(null); this.deskNo = ''; this.category = ''; this.model = ''; this.serial = '';
    this.error.set(''); this.formOpen.set(true);
  }
  closeForm() { this.formOpen.set(false); this.error.set(''); }
  reset() {
    this.editingId.set(null); this.deskNo = ''; this.category = ''; this.model = ''; this.serial = '';
    this.error.set('');
  }
  edit(row: DeskPeripheral) {
    if (!this.canEdit()) return;
    this.editingId.set(row.id); this.deskNo = row.deskNo; this.category = row.category;
    this.model = row.model; this.serial = row.serial;
    this.error.set(''); this.formOpen.set(true);
  }
  async save(event: Event) {
    event.preventDefault();
    if ((this.editingId() == null ? !this.canAdd() : !this.canEdit()) || this.saving()) return;
    this.error.set('');
    const payload: Partial<DeskPeripheral> = {
      ...(this.editingId() == null ? {} : { id: this.editingId()! }),
      deskNo: this.deskNo.trim(), category: this.category, model: this.model, serial: this.serial.trim()
    };
    const sameDeskCategory = this.data.deskPeripherals().filter(row => row.id !== this.editingId() && row.deskNo.trim().toLowerCase() === payload.deskNo!.toLowerCase() && row.category === payload.category);
    if (sameDeskCategory.length) {
      const ok = await this.ui.confirm({ title: 'Desk already has this equipment type', message: `Desk ${payload.deskNo} already has ${sameDeskCategory.length} ${payload.category} item(s). Add another one anyway?`, confirmLabel: 'Add another' });
      if (!ok) return;
    }
    this.saving.set(true);
    const result = await this.data.saveDeskPeripheral(payload);
    this.saving.set(false);
    if (!result.ok) { this.error.set(result.error || 'Could not save the desk setup.'); return; }
    this.ui.success(this.editingId() == null ? 'Desk setup added.' : 'Desk setup updated.');
    this.reset(); this.formOpen.set(false);
  }
  async remove(row: DeskPeripheral) {
    if (!this.canDelete()) return;
    const ok = await this.ui.confirm({ title: 'Remove desk item', message: `Remove the ${row.category} (${row.model}) from desk ${row.deskNo}?`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    const result = await this.data.deleteDeskPeripheral(row.id);
    if (!result.ok) this.ui.error(result.error || 'Could not remove the desk setup.');
    else this.ui.success(`Desk ${row.deskNo} item removed.`);
  }
}
