import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';
import { CustomSelectComponent } from '../shared/custom-select.component';
import { CommentsModalComponent } from '../shared/comments-modal.component';
import { Asset, SelectOption } from '../../models/models';
import { PageResult, exportXlsx, pageInfo, paginate } from '../../services/util';

interface EmpRow {
  name: string;
  department: string;
  laptop?: Asset;
  chargerIncluded: boolean;
  monitor?: Asset;
  mouse?: Asset;
  dock?: Asset;
  headset?: Asset;
}

@Component({
  selector: 'app-employees',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CustomSelectComponent, CommentsModalComponent],
  templateUrl: './employees.component.html'
})
export class EmployeesComponent {
  pageInfo = pageInfo;
  Infinity = Infinity;
  density = signal<'compact' | 'detailed'>(this.readDensity());
  sizeOptions: SelectOption[] = [{ value: '10', label: '10' }, { value: '20', label: '20' }, { value: '50', label: '50' }, { value: '100', label: '100' }, { value: 'All', label: 'All' }];

  page = signal(1);
  size = signal<number>(10);
  search = signal('');
  deptFilter = signal('All');
  catFilter = signal('All');
  statusFilter = signal('All');

  employees = computed<string[]>(() => {
    const all = this.data.assets().map(a => a.assignedTo);
    return [...new Set(all)].filter(n => n && !['stock', 'unassigned'].includes(n.toLowerCase()));
  });

  /** Build one normalized assignment index so employee search, filtering, rows,
   *  and exports don't repeatedly scan the complete asset list per employee. */
  private assetsByEmployee = computed(() => {
    const byEmployee = new Map<string, Asset[]>();
    for (const asset of this.data.assets()) {
      const key = (asset.assignedTo || '').trim().toLowerCase();
      if (!key || ['stock', 'unassigned'].includes(key)) continue;
      const assigned = byEmployee.get(key);
      if (assigned) assigned.push(asset);
      else byEmployee.set(key, [asset]);
    }
    return byEmployee;
  });
  private assetsForEmployee(name: string): Asset[] {
    return this.assetsByEmployee().get(name.trim().toLowerCase()) || [];
  }

  /** An employee's primary department (first assigned asset's dept), as shown in the table. */
  empDept(name: string): string {
    return this.assetsForEmployee(name)[0]?.department || 'IT';
  }

  /** Department filter options built from the departments actually in use. */
  deptOptions = computed<SelectOption[]>(() => {
    const depts = [...new Set(this.employees().map(n => this.empDept(n)))].sort();
    return [{ value: 'All', label: 'All Departments' }, ...depts.map(d => ({ value: d, label: d }))];
  });

  /** Category filter — an employee matches if they hold at least one asset of that category. */
  catOptions = computed<SelectOption[]>(() => [{ value: 'All', label: 'All Categories' }, ...this.data.categories().map(c => ({ value: c, label: c }))]);

  /** Status filter — an employee matches if at least one of their assets has that status. */
  statusOptions: SelectOption[] = [{ value: 'All', label: 'All Statuses' }, ...this.data.statuses.map(s => ({ value: s, label: s }))];

  /** Whether any filter/search is active (to show the "Clear filters" control). */
  hasActiveFilters = computed(() => !!this.search().trim() || this.deptFilter() !== 'All' || this.catFilter() !== 'All' || this.statusFilter() !== 'All');

  /** Employees filtered by search + department + category + status. */
  filteredEmployees = computed<string[]>(() => {
    const dept = this.deptFilter();
    const cat = this.catFilter();
    const status = this.statusFilter();
    const q = this.search().trim().toLowerCase();
    const assetsByEmployee = this.assetsByEmployee();
    return this.employees().filter(name => {
      if (dept !== 'All' && this.empDept(name) !== dept) return false;
      const owned = assetsByEmployee.get(name.trim().toLowerCase()) || [];
      if (cat !== 'All' && !owned.some(a => a.category === cat)) return false;
      if (status !== 'All' && !owned.some(a => a.status === status)) return false;
      if (!q) return true;
      if (name.toLowerCase().includes(q)) return true;
      return owned.some(a => (
        (a.department || '').toLowerCase().includes(q) ||
        (a.name || '').toLowerCase().includes(q) ||
        (a.serial || '').toLowerCase().includes(q)
      ));
    });
  });

  pageResult = computed<PageResult<string>>(() => paginate(this.sortedEmployees(), this.page(), this.size()));

  // ---- Sorting (by employee name or their primary department) ----
  sortField = signal<string>('name');
  sortAsc = signal(true);
  sortedEmployees = computed<string[]>(() => {
    const field = this.sortField();
    const asc = this.sortAsc();
    const val = (name: string) =>
      (field === 'department' ? this.empDept(name) : name).toLowerCase();
    return [...this.filteredEmployees()].sort((a, b) =>
      asc ? val(a).localeCompare(val(b)) : val(b).localeCompare(val(a)));
  });

  sort(field: string) {
    if (this.sortField() === field) this.sortAsc.set(!this.sortAsc());
    else { this.sortField.set(field); this.sortAsc.set(true); }
  }

  rows = computed<EmpRow[]>(() => this.pageResult().sliced.map(name => {
    const empAssets = this.assetsForEmployee(name);
    const laptop = empAssets.find(a => a.category === 'Laptop');
    return {
      name,
      department: empAssets.length > 0 ? (empAssets[0].department || 'IT') : 'IT',
      laptop,
      chargerIncluded: !!laptop,
      monitor: empAssets.find(a => a.category === 'Monitor'),
      mouse: empAssets.find(a => a.category === 'Mouse'),
      dock: empAssets.find(a => a.category === 'Docking Station'),
      headset: empAssets.find(a => a.category === 'Headset')
    };
  }));

  constructor(public data: DataService) {}

  private readDensity(): 'compact' | 'detailed' {
    try { return localStorage.getItem('assetflow-employee-breakdown-density') === 'compact' ? 'compact' : 'detailed'; }
    catch { return 'detailed'; }
  }

  setDensity(value: 'compact' | 'detailed') {
    this.density.set(value);
    try { localStorage.setItem('assetflow-employee-breakdown-density', value); } catch { /* Keep the session preference. */ }
  }

  // comments popup — one thread per EMPLOYEE (keyed by employee name)
  commentsName = signal<string | null>(null);
  openComments(name: string) { this.commentsName.set(name); }
  closeComments() { this.commentsName.set(null); }

  /** Comment count for an employee's thread (for the row badge). */
  commentCount(name: string) { return this.data.employeeComments()[name]?.length ?? 0; }

  changeSize(v: string) { this.size.set(v === 'All' ? Infinity : parseInt(v, 10)); this.page.set(1); }
  changePage(delta: number) { this.page.set(this.page() + delta); }
  onSearch(v: string) { this.search.set(v); this.page.set(1); }
  clearSearch() { this.search.set(''); this.page.set(1); }
  onDept(v: string) { this.deptFilter.set(v); this.page.set(1); }
  onCat(v: string) { this.catFilter.set(v); this.page.set(1); }
  onStatus(v: string) { this.statusFilter.set(v); this.page.set(1); }
  clearFilters() { this.search.set(''); this.deptFilter.set('All'); this.catFilter.set('All'); this.statusFilter.set('All'); this.page.set(1); }

  exportExcel() {
    const dataToExport = this.employees().map(empName => {
      const empAssets = this.assetsForEmployee(empName);
      const hasLaptop = empAssets.some(a => a.category === 'Laptop');
      return { 'Employee': empName, 'Department': empAssets[0]?.department || 'IT', 'Laptop Charger': hasLaptop ? 'Yes' : 'No' };
    });
    exportXlsx(dataToExport, 'Employees', 'AssetFlow_Employees.xlsx');
  }
}
