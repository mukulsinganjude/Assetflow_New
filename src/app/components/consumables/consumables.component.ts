import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { AuthService } from '../../services/auth.service';
import { UiService } from '../../services/ui.service';
import { CustomSelectComponent } from '../shared/custom-select.component';
import { EmojiPickerComponent } from '../shared/emoji-picker.component';
import { Consumable, SelectOption } from '../../models/models';
import { MAX_IMPORT_ROWS, PageResult, exportXlsx, importFileLimitError, pageInfo, paginate } from '../../services/util';


/** Empty draft used when opening the add form. */
function blankDraft(): Partial<Consumable> {
  return { name: '', category: 'Cables', quantity: 0, reorderThreshold: 5, unit: 'pcs', location: '', notes: '' };
}

@Component({
  selector: 'app-consumables',
  standalone: true,
  imports: [CommonModule, FormsModule, CustomSelectComponent, EmojiPickerComponent],
  templateUrl: './consumables.component.html'
})
export class ConsumablesComponent {
  pageInfo = pageInfo;
  Infinity = Infinity;
  canAdd = () => this.auth.can('consumables.add');
  canEdit = () => this.auth.can('consumables.edit');
  canDelete = () => this.auth.can('consumables.delete');
  canAdjust = () => this.auth.can('consumables.adjust');
  canImport = () => this.auth.can('consumables.import');
  canExport = () => this.auth.can('consumables.export');

  catOptions = computed<SelectOption[]>(() => [{ value: 'All', label: 'All Categories' }, ...this.data.consumableCategories().map(c => ({ value: c, label: c }))]);
  formCatOptions = computed<SelectOption[]>(() => this.data.consumableCategories().map(c => ({ value: c, label: c })));
  unitOptions = computed<SelectOption[]>(() => this.data.consumableUnits().map(u => ({ value: u, label: u })));
  sizeOptions: SelectOption[] = [{ value: '10', label: '10' }, { value: '20', label: '20' }, { value: '50', label: '50' }, { value: 'All', label: 'All' }];

  search = signal('');
  catFilter = signal('All');
  lowOnly = signal(false);
  page = signal(1);
  size = signal<number>(10);

  // Add / edit modal state
  modalOpen = signal(false);
  editingId = signal<number | null>(null);
  draft = signal<Partial<Consumable>>(blankDraft());
  saving = signal(false);
  formError = signal('');

  constructor(public data: DataService, public auth: AuthService, private ui: UiService) {
    this.data.loadConsumables();
  }

  /** True for a stock line at or below its reorder threshold. */
  isLow(c: Consumable): boolean { return c.quantity <= c.reorderThreshold; }
  isOut(c: Consumable): boolean { return c.quantity === 0; }

  lowStockCount = computed(() => this.data.consumables().filter(c => this.isLow(c)).length);
  totalUnits = computed(() => this.data.consumables().reduce((sum, c) => sum + c.quantity, 0));

  private filtered = computed<Consumable[]>(() => {
    const q = this.search().toLowerCase();
    const cat = this.catFilter();
    const low = this.lowOnly();
    return this.data.consumables().filter(c => {
      const matchesQuery = c.name.toLowerCase().includes(q) || (c.location || '').toLowerCase().includes(q);
      const matchesCat = cat === 'All' || c.category === cat;
      const matchesLow = !low || this.isLow(c);
      return matchesQuery && matchesCat && matchesLow;
    });
  });

  pageResult = computed<PageResult<Consumable>>(() => paginate(this.sorted(), this.page(), this.size()));

  // ---- Sorting ----
  sortField = signal<string>('name');
  sortAsc = signal(true);
  private sorted = computed<Consumable[]>(() => {
    const field = this.sortField();
    const asc = this.sortAsc();
    const numeric = field === 'quantity' || field === 'reorderThreshold';
    return [...this.filtered()].sort((a, b) => {
      if (numeric) {
        const cmp = (((a as any)[field] as number) || 0) - (((b as any)[field] as number) || 0);
        return asc ? cmp : -cmp;
      }
      const valA = ((a as any)[field] || '').toString().toLowerCase();
      const valB = ((b as any)[field] || '').toString().toLowerCase();
      return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  });

  sort(field: string) {
    if (this.sortField() === field) this.sortAsc.set(!this.sortAsc());
    else { this.sortField.set(field); this.sortAsc.set(true); }
  }

  hasActiveFilters = computed(() => !!this.search() || this.catFilter() !== 'All' || this.lowOnly());

  onSearch(v: string) { this.search.set(v); this.page.set(1); }
  clearSearch() { this.search.set(''); this.page.set(1); }
  onCat(v: string) { this.catFilter.set(v); this.page.set(1); }
  toggleLowOnly() { this.lowOnly.set(!this.lowOnly()); this.page.set(1); }
  clearFilters() { this.search.set(''); this.catFilter.set('All'); this.lowOnly.set(false); this.page.set(1); }
  changeSize(v: string) { this.size.set(v === 'All' ? Infinity : parseInt(v, 10)); this.page.set(1); }
  changePage(delta: number) { this.page.set(this.page() + delta); }

  // ---- Add / edit ----
  openAdd() {
    if (!this.canAdd()) return;
    this.editingId.set(null);
    this.draft.set(blankDraft());
    this.formError.set('');
    this.modalOpen.set(true);
  }
  openEdit(c: Consumable) {
    if (!this.canEdit()) return;
    this.editingId.set(c.id);
    this.draft.set({ name: c.name, category: c.category, quantity: c.quantity, reorderThreshold: c.reorderThreshold, unit: c.unit, location: c.location, notes: c.notes });
    this.formError.set('');
    this.modalOpen.set(true);
  }
  closeModal() { if (!this.saving()) this.modalOpen.set(false); }

  patch<K extends keyof Consumable>(key: K, value: Consumable[K]) {
    this.draft.update(d => ({ ...d, [key]: value }));
  }

  async save() {
    if (this.saving()) return;
    if (this.editingId() == null ? !this.canAdd() : !this.canEdit()) return;
    const d = this.draft();
    if (!d.name || !d.name.trim()) { this.formError.set('Item name is required.'); return; }
    if (d.quantity == null || !Number.isInteger(Number(d.quantity)) || Number(d.quantity) < 0 || Number(d.quantity) > 1_000_000) { this.formError.set('Quantity must be a whole number between 0 and 1,000,000.'); return; }
    if (d.reorderThreshold == null || !Number.isInteger(Number(d.reorderThreshold)) || Number(d.reorderThreshold) < 0 || Number(d.reorderThreshold) > 1_000_000) { this.formError.set('Reorder threshold must be a whole number between 0 and 1,000,000.'); return; }
    const duplicate = this.data.consumables().find(item => item.id !== this.editingId() && item.name.trim().toLowerCase() === d.name!.trim().toLowerCase() && (item.location || '').trim().toLowerCase() === (d.location || '').trim().toLowerCase());
    if (duplicate) { this.formError.set(`"${duplicate.name}" already exists at this location. Update that stock record instead.`); return; }
    const existing = this.data.consumables().find(item => item.id === this.editingId());
    if (existing && existing.quantity > existing.reorderThreshold && Number(d.quantity) <= Number(d.reorderThreshold)) {
      const ok = await this.ui.confirm({ title: 'Item will be low in stock', message: `Saving this change puts ${d.name} at or below its reorder level (${d.quantity} ${d.unit || existing.unit} remaining; reorder at ${d.reorderThreshold}). Continue?`, confirmLabel: 'Save anyway' });
      if (!ok) return;
    }
    this.saving.set(true);
    this.formError.set('');
    const id = this.editingId();
    const res = id == null ? await this.data.addConsumable(d) : await this.data.updateConsumable(id, d);
    this.saving.set(false);
    if (!res.ok) { this.formError.set(res.error || 'Could not save.'); return; }
    this.ui.success(id == null ? 'Consumable added.' : 'Consumable updated.');
    this.modalOpen.set(false);
  }

  async adjust(c: Consumable, delta: number) {
    if (!this.canAdjust()) return;
    const res = await this.data.adjustConsumable(c.id, delta);
    if (!res.ok) { this.ui.error(res.error || 'Could not adjust stock.'); return; }
    if (this.isLow({ ...c, quantity: c.quantity + delta })) this.ui.info(`${c.name} is at or below its reorder level.`);
  }

  async remove(c: Consumable) {
    if (!this.canDelete()) return;
    const ok = await this.ui.confirm({ title: 'Delete consumable', message: `Delete "${c.name}"? This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const res = await this.data.deleteConsumable(c.id);
    if (!res.ok) { this.ui.error(res.error || 'Could not delete.'); return; }
    this.ui.success('Consumable deleted.');
  }

  exportExcel() {
    if (!this.canExport()) return;
    const rows = this.sorted().map(c => ({
      'Item Name': c.name,
      'Category': c.category,
      'Quantity': c.quantity,
      'Unit': c.unit,
      'Reorder Threshold': c.reorderThreshold,
      'Location': c.location,
      'Status': this.isOut(c) ? 'Out of stock' : this.isLow(c) ? 'Low' : 'OK',
      'Notes': c.notes
    }));
    exportXlsx(rows, 'Consumables', 'AssetFlow_Consumables.xlsx');
  }
  downloadTemplate() { exportXlsx([{ 'Item Name': 'USB-C cable', Category: 'Cables', Quantity: 10, Unit: 'pcs', 'Reorder Threshold': 3, Location: 'IT storage', Notes: '' }], 'Consumables Template', 'AssetFlow_Consumables_Template.xlsx'); }
  importExcel(event: Event) { if (!this.canImport()) return; const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return; const limitError = importFileLimitError(file); if (limitError) { this.ui.error(limitError); input.value = ''; return; } const reader = new FileReader(); reader.onload = async e => { try { const wb = XLSX.read(new Uint8Array((e.target as FileReader).result as ArrayBuffer), { type: 'array', sheetRows: MAX_IMPORT_ROWS + 2 }); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]); if (rows.length > MAX_IMPORT_ROWS) { this.ui.error(`This spreadsheet has more than ${MAX_IMPORT_ROWS} rows. Split it into smaller files and try again.`); return; } if (!await this.ui.confirmImport(rows.length, 'consumables')) return; const result = await this.data.importConsumables(rows); this.ui.success(`Imported ${result.imported} consumable item(s).`); if (result.skipped) this.ui.error(`Skipped ${result.skipped}:\\n- ${result.errors.slice(0, 8).join('\\n- ')}`, 8000); } catch { this.ui.error('Could not parse or import this file. Use the Consumables template.'); } finally { input.value = ''; } }; reader.readAsArrayBuffer(file); }
}
