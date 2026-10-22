import { Component, EventEmitter, Input, Output, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { AuthService } from '../../services/auth.service';
import { UiService } from '../../services/ui.service';
import { AccessoryChecklist, Asset, AssetAssignmentType, AssetCondition, SelectOption } from '../../models/models';
import { CustomSelectComponent } from './custom-select.component';
import { AutocompleteComponent } from './autocomplete.component';
import { EmojiPickerComponent } from './emoji-picker.component';

/**
 * Reusable check-in / check-out popup for a single asset.
 *  - Check OUT: assign the asset to a person (status defaults to "In Use").
 *  - Check IN:  return the asset to storage / Stock (status defaults to
 *               "In Storage").
 * An optional reason is recorded on the asset's history timeline. Set [assetId]
 * to open (null hides); handle (closed) to clear it. Reads the live asset from
 * DataService by id so it stays in sync. Requires a non-viewer (canWrite).
 */
@Component({
  selector: 'app-assign-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, CustomSelectComponent, AutocompleteComponent, EmojiPickerComponent],
  templateUrl: './assign-modal.component.html'
})
export class AssignModalComponent {
  private _assetId = signal<number | null>(null);
  @Input() set assetId(v: number | null) {
    this._assetId.set(v ?? null);
    if (v == null) this.reset();
  }
  get assetId(): number | null { return this._assetId(); }
  private _initialMode = signal<'in' | 'out' | null>(null);
  @Input() set initialMode(value: 'in' | 'out' | null) { this._initialMode.set(value ?? null); }
  get initialMode(): 'in' | 'out' | null { return this._initialMode(); }

  @Output() closed = new EventEmitter<void>();

  mode = signal<'out' | 'in'>('out');
  person = signal('');
  assignmentType = signal<AssetAssignmentType>('Primary');
  assignmentTypeOptions: SelectOption[] = [{ value: 'Primary', label: 'Primary' }, { value: 'Temporary', label: 'Temporary' }];
  reason = signal('');
  condition = signal<AssetCondition>('Good');
  readonly conditionOptions: SelectOption[] = [
    { value: 'Good', label: 'Good' },
    { value: 'Damaged', label: 'Damaged' },
    { value: 'Needs repair', label: 'Needs repair' }
  ];
  accessories = signal<AccessoryChecklist>({ charger: false, mouse: false, dockingStation: false, bag: false, adapter: false });
  readonly accessoryFields: { key: keyof AccessoryChecklist; label: string }[] = [
    { key: 'charger', label: 'Charger / power adapter' }, { key: 'mouse', label: 'Mouse' },
    { key: 'dockingStation', label: 'Docking station' }, { key: 'bag', label: 'Laptop bag' }, { key: 'adapter', label: 'Other adapter' }
  ];
  saving = signal(false);
  error = signal('');

  open = computed(() => this._assetId() != null);
  asset = computed<Asset | null>(() => {
    const id = this._assetId();
    return id == null ? null : (this.data.assets().find(a => a.id === id) ?? null);
  });

  /** Assignable employees are restricted to the Manage Employees roster. */
  employeeList = computed<string[]>(() => this.data.employeeRoster().map(employee => employee.name));

  primaryAssetConflicts(assignedTo: string, category: string, assetId: number): Asset[] {
    const employee = assignedTo.trim().toLowerCase();
    const assetCategory = category.trim().toLowerCase();
    if (!employee || ['stock', 'unassigned'].includes(employee) || !assetCategory) return [];
    return this.data.assets().filter(item => item.id !== assetId &&
      item.category.trim().toLowerCase() === assetCategory &&
      item.assignedTo.trim().toLowerCase() === employee &&
      (item.assignmentType || 'Primary').trim().toLowerCase() === 'primary'
    );
  }

  constructor(public data: DataService, public auth: AuthService, private ui: UiService) {
    // Seed the composer ONCE per opened asset (keyed by id): if it's already
    // assigned, default to checking it IN, otherwise OUT. Guarding by id keeps a
    // background asset refresh from wiping what the user is typing.
    effect(() => {
      const id = this._assetId();
      const a = this.asset();
      if (id == null || !a) { this.seededFor = null; return; }
      if (this.seededFor === id) return;
      this.seededFor = id;
      const assigned = !!a.assignedTo && !['stock', 'unassigned'].includes(a.assignedTo.toLowerCase());
      this.mode.set(this._initialMode() ?? (assigned ? 'in' : 'out'));
      this.person.set('');
      this.assignmentType.set('Primary');
      this.reason.set('');
      this.condition.set('Good');
      this.accessories.set(this.emptyAccessories());
      this.error.set('');
    });
  }
  private seededFor: number | null = null;
  private emptyAccessories(): AccessoryChecklist { return { charger: false, mouse: false, dockingStation: false, bag: false, adapter: false }; }

  get canWrite() { return this.auth.can('assets.assign'); }
  close() { this.closed.emit(); }

  private reset() {
    this.person.set('');
    this.assignmentType.set('Primary');
    this.reason.set('');
    this.condition.set('Good');
    this.accessories.set(this.emptyAccessories());
    this.error.set('');
    this.saving.set(false);
    this.seededFor = null;
  }

  setMode(m: 'out' | 'in') { this.mode.set(m); this.error.set(''); }
  setAssignmentType(value: string) { this.assignmentType.set(value === 'Temporary' ? 'Temporary' : 'Primary'); }
  setCondition(value: string) {
    if (this.conditionOptions.some(option => option.value === value)) this.condition.set(value as AssetCondition);
  }
  setAccessory(key: keyof AccessoryChecklist, value: boolean) { this.accessories.update(current => ({ ...current, [key]: value })); }

  async submit() {
    const a = this.asset();
    if (!a || this.saving()) return;
    const checkingIn = this.mode() === 'in';
    const assignedTo = checkingIn ? 'Stock' : this.person().trim();
    if (!checkingIn && !assignedTo) { this.error.set('Enter the employee to assign this asset to.'); return; }
    if (!checkingIn && ['stock', 'unassigned'].includes(assignedTo.toLowerCase())) {
      this.error.set('"Stock" isn\'t a valid person to check out to. Use Check In instead.');
      return;
    }
    const selectedEmployee = this.data.employeeRoster().find(employee => employee.name.toLowerCase() === assignedTo.toLowerCase());
    if (!checkingIn && !selectedEmployee) { this.error.set('Select an employee from Manage Employees before checking out an asset.'); return; }
    const status = checkingIn ? 'In Storage' : 'In Use';
    if (!checkingIn && a.category.trim().toLowerCase() === 'laptop') {
      const activeCount = this.data.assets().filter(item =>
        item.id !== a.id &&
        item.category.trim().toLowerCase() === 'laptop' &&
        item.assignedTo.trim().toLowerCase() === assignedTo.toLowerCase() &&
        item.status.trim().toLowerCase() === 'in use'
      ).length;
      if (activeCount >= 2) {
        this.error.set(`${assignedTo} already has two active laptops. Return or unassign a laptop before assigning another.`);
        return;
      }
    }
    this.saving.set(true);
    const res = await this.data.assignAsset(a.id, {
      assignedTo: selectedEmployee?.name || assignedTo,
      status,
      reason: this.reason().trim(),
      assignmentType: checkingIn ? (a.assignmentType || 'Primary') : this.assignmentType(),
      condition: this.condition(),
      ...(a.category === 'Laptop' ? { handoverChecklist: this.accessories() } : {})
    });
    this.saving.set(false);
    if (!res.ok) { this.error.set(res.error || 'Could not update the asset.'); return; }
    this.ui.success(checkingIn
      ? `Checked in "${a.name}" to storage.`
      : `Checked out "${a.name}" to ${assignedTo}.`);
    this.close();
  }
}
