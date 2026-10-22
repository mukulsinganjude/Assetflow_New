import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService, DropdownOptions } from '../../services/data.service';
import { UiService } from '../../services/ui.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-dropdown-manager', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './dropdown-manager.component.html'
})
export class DropdownManagerComponent implements OnInit {
  section = signal<'assets' | 'consumables'>('assets');
  selectedCategory = signal('Laptop');
  categoryDraft = '';
  modelDraft = '';
  consumableCategoryDraft = '';
  unitDraft = '';
  saving = signal(false);
  error = signal('');

  constructor(public data: DataService, public auth: AuthService, private ui: UiService) {}
  ngOnInit() { void this.data.loadDropdownOptions(); }
  canManage(): boolean { return this.auth.can('dropdowns.manage'); }
  options(): DropdownOptions { return this.data.dropdownOptions(); }
  setOptions(next: DropdownOptions) { this.data.dropdownOptions.set(next); }
  addAssetCategory() {
    if (!this.canManage()) return;
    const value = this.categoryDraft.trim(); if (!value) return;
    if (this.options().assetCategories.some(item => item.toLowerCase() === value.toLowerCase())) { this.error.set('That asset category already exists.'); return; }
    const config = this.options(); this.setOptions({ ...config, assetCategories: [...config.assetCategories, value], assetModels: { ...config.assetModels, [value]: [] } });
    this.selectedCategory.set(value); this.categoryDraft = ''; this.error.set('');
  }
  removeAssetCategory(category: string) {
    if (!this.canManage()) return;
    if (this.data.deskCategories().includes(category)) return;
    const config = this.options(); this.setOptions({ ...config, assetCategories: config.assetCategories.filter(item => item !== category), assetModels: Object.fromEntries(Object.entries(config.assetModels).filter(([key]) => key !== category)) });
    this.selectedCategory.set(this.options().assetCategories[0] || '');
  }
  addModel() {
    if (!this.canManage()) return;
    const value = this.modelDraft.trim(), category = this.selectedCategory(); if (!value || !category) return;
    const config = this.options(), models = config.assetModels[category] || [];
    if (models.some(item => item.toLowerCase() === value.toLowerCase())) { this.error.set('That model already exists in this category.'); return; }
    this.setOptions({ ...config, assetModels: { ...config.assetModels, [category]: [...models, value] } }); this.modelDraft = ''; this.error.set('');
  }
  removeModel(category: string, model: string) { if (!this.canManage()) return; const config = this.options(); this.setOptions({ ...config, assetModels: { ...config.assetModels, [category]: (config.assetModels[category] || []).filter(item => item !== model) } }); }
  addConsumableOption(kind: 'category' | 'unit') {
    if (!this.canManage()) return;
    const isCategory = kind === 'category', value = (isCategory ? this.consumableCategoryDraft : this.unitDraft).trim(); if (!value) return;
    const config = this.options(), key = isCategory ? 'consumableCategories' : 'consumableUnits', list = config[key];
    if (list.some(item => item.toLowerCase() === value.toLowerCase())) { this.error.set('That option already exists.'); return; }
    this.setOptions({ ...config, [key]: [...list, value] });
    if (isCategory) this.consumableCategoryDraft = ''; else this.unitDraft = ''; this.error.set('');
  }
  removeConsumableOption(kind: 'category' | 'unit', value: string) {
    if (!this.canManage()) return;
    const config = this.options(), key = kind === 'category' ? 'consumableCategories' : 'consumableUnits';
    this.setOptions({ ...config, [key]: config[key].filter(item => item !== value) });
  }
  async save() {
    if (!this.canManage()) return;
    this.saving.set(true); this.error.set('');
    const result = await this.data.saveDropdownOptions(this.options()); this.saving.set(false);
    if (!result.ok) { this.error.set(result.error || 'Could not save dropdown data.'); return; }
    this.ui.success('Dropdown data saved and connected to the asset forms.');
  }
  async discard() {
    if (!this.canManage()) return;
    await this.data.loadDropdownOptions();
    const first = this.options().assetCategories[0]; this.selectedCategory.set(first || ''); this.error.set('');
  }
}
