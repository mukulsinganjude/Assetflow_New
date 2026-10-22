import { AfterViewInit, Component, OnDestroy, OnInit, computed, effect, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { DataService } from '../../services/data.service';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { UiService } from '../../services/ui.service';
import { CustomSelectComponent } from '../shared/custom-select.component';
import { AutocompleteComponent } from '../shared/autocomplete.component';
import { AssignModalComponent } from '../shared/assign-modal.component';
import { DellCasePopupComponent } from '../shared/dell-case-popup.component';
import { EmojiPickerComponent } from '../shared/emoji-picker.component';
import { Asset, AssetAssignmentType, CommentEntry, SelectOption } from '../../models/models';
import { PageResult, categoryIcon, exportXlsx, pageInfo, paginate, statusBadge } from '../../services/util';

declare const Chart: any;

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CustomSelectComponent, AutocompleteComponent, AssignModalComponent, DellCasePopupComponent, EmojiPickerComponent],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  /** Deep-link: /dashboard?asset=ID auto-opens that asset's detail modal (used
   *  by the "open asset" links on the employee detail page). Set from the query
   *  param in ngOnInit; the effect below opens the modal once the asset loads. */
  private focusAssetId = signal<number | null>(null);
  private requestedAssignMode = signal<'in' | 'out' | null>(null);
  private lastFocused: number | null = null;
  private qpSub?: Subscription;

  search = signal('');
  categoryFilter = signal('All');
  deptFilter = signal('All');
  sortField = signal('name');
  sortAsc = signal(true);
  page = signal(1);
  size = signal<number>(10);
  density = signal<'compact' | 'detailed'>(this.readDensity());
  selected = signal<Set<number>>(new Set());
  bulkStatus = signal('');

  // ---- Check-in / check-out (shared assign modal), tracked by asset id ----
  assignId = signal<number | null>(null);
  assignMode = signal<'in' | 'out' | null>(null);
  openAssign(a: Asset) { if (this.canAssign) this.assignId.set(a.id); }
  closeAssign() { this.assignId.set(null); this.assignMode.set(null); }

  // ---- Asset detail / edit modal ----
  assetModalOpen = signal(false);
  modalMode = signal<'view' | 'edit'>('view');
  modalError = signal('');
  linkedDellCaseId = signal<number | null>(null);
  linkedDellCaseAsset = signal<Asset | null>(null);
  modalSaving = signal(false);
  viewAsset: Asset | null = null;

  // Track the open asset by id so the comments list stays live across the
  // loadAssets() refresh that follows every add/delete (viewAsset itself is a
  // stale snapshot after a reload; liveComments reads from the fresh signal).
  viewAssetId = signal<number | null>(null);
  newComment = signal('');
  commentSaving = signal(false);
  liveComments = computed<CommentEntry[]>(() => {
    const id = this.viewAssetId();
    if (id == null) return [];
    const a = this.data.assets().find(x => x.id === id);
    return a?.comments ?? [];
  });

  editCategoryOptions = computed<SelectOption[]>(() => this.data.categories().map(c => ({ value: c, label: c })));
  editDeptOptions: SelectOption[] = [];
  editStatusOptions: SelectOption[] = [];
  assignmentTypeOptions: SelectOption[] = [{ value: 'Primary', label: 'Primary' }, { value: 'Temporary', label: 'Temporary' }];

  eId = 0;
  eCategory = signal('Laptop');
  eName = signal('');
  eDepartment = signal('IT');
  eStatus = signal('In Use');
  eSerial = '';
  eAssignmentType = signal<AssetAssignmentType>('Primary');
  eAssignedTo = '';
  ePurchaseDate = '';
  eWarrantyDate = '';

  editModelOptions = computed<SelectOption[]>(() => (this.data.catalog()[this.eCategory()] || []).map(m => ({ value: m, label: m })));
  assignableEmployees = computed<string[]>(() => [...this.data.employeeRoster().map(employee => employee.name), 'Stock']);

  categoryIcon = categoryIcon;
  statusBadge = statusBadge;
  pageInfo = pageInfo;
  Infinity = Infinity;

  categoryOptions = computed<SelectOption[]>(() => [{ value: 'All', label: 'All Categories' }, ...this.data.categories().map(c => ({ value: c, label: c }))]);
  deptOptions: SelectOption[] = [];
  bulkOptions: SelectOption[] = [];
  sizeOptions: SelectOption[] = [{ value: '10', label: '10' }, { value: '20', label: '20' }, { value: '50', label: '50' }, { value: '100', label: '100' }];

  private categoryChart: any = null;
  private departmentChart: any = null;
  private departmentTrendChart: any = null;

  filtered = computed<Asset[]>(() => {
    const q = this.search().toLowerCase();
    const cat = this.categoryFilter();
    const dept = this.deptFilter();
    return this.data.assets().filter(item => {
      const matchesQuery = item.name.toLowerCase().includes(q) || item.serial.toLowerCase().includes(q) || (item.assignedTo && item.assignedTo.toLowerCase().includes(q));
      const matchesCategory = cat === 'All' || item.category === cat;
      const matchesDept = dept === 'All' || item.department === dept;
      return matchesQuery && matchesCategory && matchesDept;
    });
  });

  sorted = computed<Asset[]>(() => {
    const field = this.sortField();
    const asc = this.sortAsc();
    return [...this.filtered()].sort((a, b) => {
      const valA = ((a as any)[field] || '').toString().toLowerCase();
      const valB = ((b as any)[field] || '').toString().toLowerCase();
      return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  });

  pageResult = computed<PageResult<Asset>>(() => paginate(this.sorted(), this.page(), this.size()));

  stats = computed(() => {
    const d = this.filtered();
    return {
      total: d.length,
      inUse: d.filter(i => i.status === 'In Use').length,
      storage: d.filter(i => i.status === 'In Storage').length,
      repair: d.filter(i => i.status === 'Under Repair').length
    };
  });

  // KPI trend indicators. "Added this week" uses each asset's earliest history
  // entry (the "Registered" event); legacy assets without history simply don't
  // count toward the weekly delta. Percentages are share-of-fleet for the
  // current filter. All derived from data already in memory — no extra requests.
  trends = computed(() => {
    const d = this.filtered();
    const total = d.length || 1;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const addedThisWeek = d.filter(a => {
      const h = a.history;
      if (!h || !h.length) return false;
      const first = h[h.length - 1]; // history is newest-first, so last = registration
      const t = first ? new Date(first.ts).getTime() : NaN;
      return !isNaN(t) && t >= weekAgo;
    }).length;
    const s = this.stats();
    return {
      addedThisWeek,
      inUsePct: Math.round((s.inUse / total) * 100),
      storagePct: Math.round((s.storage / total) * 100),
      repairPct: Math.round((s.repair / total) * 100)
    };
  });

  constructor(public data: DataService, public auth: AuthService, public theme: ThemeService, private ui: UiService) {
    this.deptOptions = [{ value: 'All', label: 'All Departments' }, ...[...this.data.departments, 'Stock'].map(d => ({ value: d, label: d }))];
    this.bulkOptions = [{ value: '', label: 'Update Status...' }, ...this.data.statuses.map(s => ({ value: s, label: s }))];
    this.editDeptOptions = [...this.data.departments, 'Stock'].map(d => ({ value: d, label: d }));
    this.editStatusOptions = this.data.statuses.map(s => ({ value: s, label: s }));
    effect(() => {
      // re-render charts when filtered data or theme changes. Debounced so that
      // typing in the search box (which changes filtered() on every keystroke)
      // doesn't destroy+rebuild three Chart.js charts on every character.
      this.filtered();
      this.theme.isDark();
      this.scheduleChartRender();
    });
    effect(() => {
      // Deep-link handler: when ?asset=ID is present and that asset has loaded,
      // open its detail modal once. Read both signals up-front so dependency
      // tracking is stable, and defer openDetail() to a macrotask so the modal
      // signals are written OUTSIDE the reactive/CD pass (otherwise the modal
      // can fail to render right after navigation).
      const id = this.focusAssetId();
      const action = this.requestedAssignMode();
      const assets = this.data.assets();
      if (id == null) { this.lastFocused = null; return; }
      if (id === this.lastFocused) return;
      const asset = assets.find(a => a.id === id);
      if (asset) {
        this.lastFocused = id;
        if (action && this.canEdit) {
          setTimeout(() => { this.assignMode.set(action); this.assignId.set(asset.id); });
        } else setTimeout(() => this.openDetail(asset));
      }
    });
  }

  ngOnInit() {
    void this.data.loadDellCases();
    // Drive focusAssetId from the ?asset= query param (explicit subscription so
    // the value is captured reliably regardless of navigation timing).
    this.qpSub = this.route.queryParamMap.subscribe(pm => {
      const raw = pm.get('asset');
      const n = raw != null ? Number(raw) : NaN;
      this.focusAssetId.set(!isNaN(n) ? n : null);
      const action = pm.get('action');
      this.requestedAssignMode.set(action === 'checkin' ? 'in' : action === 'checkout' ? 'out' : null);
      if (action && n === this.lastFocused) this.lastFocused = null;
    });
  }

  private chartTimer: any = null;
  private scheduleChartRender() {
    if (this.chartTimer) clearTimeout(this.chartTimer);
    this.chartTimer = setTimeout(() => this.renderCharts(), 220);
  }

  ngAfterViewInit() { setTimeout(() => this.renderCharts()); }
  ngOnDestroy() {
    if (this.chartTimer) clearTimeout(this.chartTimer);
    this.qpSub?.unsubscribe();
    [this.categoryChart, this.departmentChart, this.departmentTrendChart].forEach(c => c && c.destroy());
  }

  private renderCharts() {
    if (typeof Chart === 'undefined') return;
    const dataset = this.filtered();
    const textColor = document.documentElement.classList.contains('dark') ? '#94a3b8' : '#64748b';
    const el = (id: string) => document.getElementById(id) as HTMLCanvasElement | null;

    const categories = this.data.categories();
    const catCounts = categories.map(cat => dataset.filter(i => i.category === cat).length);
    const cCat = el('categoryChart');
    if (cCat) {
      if (this.categoryChart) {
        this.categoryChart.data.labels = categories;
        this.categoryChart.data.datasets[0].data = catCounts;
        this.categoryChart.options.scales.y.ticks.color = textColor;
        this.categoryChart.options.scales.x.ticks.color = textColor;
        this.categoryChart.update('none');
      } else {
        this.categoryChart = new Chart(cCat.getContext('2d'), {
          type: 'bar',
          data: { labels: categories, datasets: [{ label: 'Units', data: catCounts, backgroundColor: '#6366f1', borderRadius: 8 }] },
          options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { color: textColor, precision: 0 } }, x: { ticks: { color: textColor, font: { size: 10 } } } } }
        });
      }
    }

    const departments = [...this.data.departments, 'Stock'];
    const deptCounts = departments.map(dep => dataset.filter(i => i.department === dep).length);
    const cDept = el('departmentChart');
    if (cDept) {
      if (this.departmentChart) {
        this.departmentChart.data.labels = departments;
        this.departmentChart.data.datasets[0].data = deptCounts;
        this.departmentChart.options.plugins.legend.labels.color = textColor;
        this.departmentChart.update('none');
      } else {
        this.departmentChart = new Chart(cDept.getContext('2d'), {
          type: 'pie',
          data: { labels: departments, datasets: [{ data: deptCounts, backgroundColor: ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6'], borderWidth: 0 }] },
          options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom', labels: { color: textColor, boxWidth: 10 } } } }
        });
      }
    }

    const deptInUse = departments.map(d => dataset.filter(i => i.department === d && i.status === 'In Use').length);
    const deptStorage = departments.map(d => dataset.filter(i => i.department === d && i.status === 'In Storage').length);
    const deptRepair = departments.map(d => dataset.filter(i => i.department === d && i.status === 'Under Repair').length);
    const cTrend = el('departmentTrendChart');
    if (cTrend) {
      const dark = document.documentElement.classList.contains('dark');
      const gridColor = dark ? 'rgba(203,213,225,.10)' : 'rgba(100,116,139,.12)';
      const tooltipBackground = dark ? 'rgba(30,34,42,.96)' : 'rgba(255,255,255,.97)';
      const tooltipBorder = dark ? 'rgba(203,213,225,.2)' : 'rgba(100,116,139,.2)';
      if (this.departmentTrendChart) {
        this.departmentTrendChart.data.labels = departments;
        this.departmentTrendChart.data.datasets[0].data = deptInUse;
        this.departmentTrendChart.data.datasets[1].data = deptStorage;
        this.departmentTrendChart.data.datasets[2].data = deptRepair;
        this.departmentTrendChart.options.plugins.legend.labels.color = textColor;
        this.departmentTrendChart.options.plugins.tooltip.backgroundColor = tooltipBackground;
        this.departmentTrendChart.options.plugins.tooltip.titleColor = dark ? '#f8fafc' : '#1e293b';
        this.departmentTrendChart.options.plugins.tooltip.bodyColor = dark ? '#e2e8f0' : '#334155';
        this.departmentTrendChart.options.plugins.tooltip.borderColor = tooltipBorder;
        this.departmentTrendChart.options.scales.x.ticks.color = textColor;
        this.departmentTrendChart.options.scales.x.grid.color = gridColor;
        this.departmentTrendChart.options.scales.y.ticks.color = textColor;
        this.departmentTrendChart.options.scales.y.grid.color = gridColor;
        this.departmentTrendChart.update('none');
      } else {
        this.departmentTrendChart = new Chart(cTrend.getContext('2d'), {
          type: 'line',
          data: { labels: departments, datasets: [
            { label: 'In Use', data: deptInUse, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.08)', fill: true, tension: .36, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: '#22c55e', pointBorderWidth: 0 },
            { label: 'In Storage', data: deptStorage, borderColor: dark ? '#cbd5e1' : '#374151', backgroundColor: 'transparent', fill: false, tension: .36, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: dark ? '#cbd5e1' : '#374151', pointBorderWidth: 0 },
            { label: 'Under Repair', data: deptRepair, borderColor: '#ef5a78', backgroundColor: 'transparent', fill: false, tension: .36, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: '#ef5a78', pointBorderWidth: 0 }
          ] },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { position: 'bottom', labels: { color: textColor, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 18, font: { size: 11 } } },
              tooltip: { backgroundColor: tooltipBackground, titleColor: dark ? '#f8fafc' : '#1e293b', bodyColor: dark ? '#e2e8f0' : '#334155', borderColor: tooltipBorder, borderWidth: 1, padding: 11, displayColors: true, usePointStyle: true }
            },
            scales: {
              x: { grid: { color: gridColor, borderDash: [2, 4], drawTicks: false }, border: { display: false }, ticks: { color: textColor, font: { size: 10 }, maxRotation: 0 } },
              y: { beginAtZero: true, ticks: { color: textColor, precision: 0, maxTicksLimit: 5 }, grid: { color: gridColor, borderDash: [2, 4], drawTicks: false }, border: { display: false } }
            }
          },
          plugins: [{
            id: 'departmentHoverGuide',
            beforeTooltipDraw: (chart: any) => {
              const active = chart.tooltip?.getActiveElements?.();
              if (!active?.length) return;
              const x = active[0].element.x;
              const { top, bottom } = chart.chartArea;
              const ctx = chart.ctx;
              ctx.save();
              ctx.beginPath();
              ctx.setLineDash([3, 4]);
              ctx.moveTo(x, top);
              ctx.lineTo(x, bottom);
              ctx.lineWidth = 1;
              ctx.strokeStyle = dark ? 'rgba(226,232,240,.48)' : 'rgba(71,85,105,.42)';
              ctx.stroke();
              ctx.restore();
            }
          }]
        });
      }
    }

  }

  sort(field: string) {
    if (this.sortField() === field) this.sortAsc.set(!this.sortAsc());
    else { this.sortField.set(field); this.sortAsc.set(true); }
  }

  private readDensity(): 'compact' | 'detailed' {
    try { return localStorage.getItem('assetflow-asset-density') === 'compact' ? 'compact' : 'detailed'; }
    catch { return 'detailed'; }
  }

  setDensity(value: 'compact' | 'detailed') {
    this.density.set(value);
    try { localStorage.setItem('assetflow-asset-density', value); } catch { /* Preference remains active for this session. */ }
  }

  onSearch() { this.page.set(1); this.selected.set(new Set()); }
  onFilter() { this.page.set(1); this.selected.set(new Set()); }
  changeSize(v: string) { this.size.set(v === 'All' ? Infinity : parseInt(v, 10)); this.page.set(1); }
  changePage(delta: number) { this.page.set(this.page() + delta); }

  isSelected(id: number) { return this.selected().has(id); }
  toggleRow(id: number, checked: boolean) {
    const next = new Set(this.selected());
    if (checked) next.add(id); else next.delete(id);
    this.selected.set(next);
  }
  toggleAll(checked: boolean) {
    const next = new Set(this.selected());
    for (const item of this.pageResult().sliced) {
      if (checked) next.add(item.id); else next.delete(item.id);
    }
    this.selected.set(next);
  }
  get canSelect() { return this.auth.canAny('assets.edit', 'assets.delete'); }
  get canEdit() { return this.auth.can('assets.edit'); }
  get canAdd() { return this.auth.can('assets.add'); }
  get canAssign() { return this.auth.can('assets.assign'); }
  get canDelete() { return this.auth.can('assets.delete'); }
  get canComment() { return this.auth.can('assets.comment'); }

  // ---- Detail / edit modal ----
  openDetail(a: Asset) {
    this.viewAsset = a;
    this.viewAssetId.set(a.id);
    this.newComment.set('');
    this.modalMode.set('view');
    this.modalError.set('');
    this.assetModalOpen.set(true);
  }

  openEdit(a: Asset) {
    if (!this.canEdit) return;
    this.eId = a.id;
    this.eCategory.set(a.category);
    this.eName.set(a.name);
    this.eStatus.set(a.status);
    this.eSerial = a.serial;
    this.eAssignmentType.set(a.assignmentType || 'Primary');
    this.eAssignedTo = a.assignedTo && a.assignedTo !== 'Stock' ? a.assignedTo : '';
    this.eDepartment.set(this.departmentFor(this.eStatus(), this.eAssignedTo, a.department));
    this.ePurchaseDate = a.purchaseDate;
    this.eWarrantyDate = a.warrantyDate;
    this.viewAsset = a;
    this.viewAssetId.set(a.id);
    this.modalError.set('');
    this.modalMode.set('edit');
    this.assetModalOpen.set(true);
  }

  openDellCase(caseId: number | null, event: Event) { event.stopPropagation(); if (caseId != null) this.linkedDellCaseId.set(caseId); }
  openDellCaseForAsset(asset: Asset, event: Event) { event.stopPropagation(); this.linkedDellCaseId.set(null); this.linkedDellCaseAsset.set(asset); }
  closeDellCase() { this.linkedDellCaseId.set(null); this.linkedDellCaseAsset.set(null); }

  switchToEdit() { if (this.viewAsset) this.openEdit(this.viewAsset); }
  primaryAssetConflicts(category: string, assignedTo: string): Asset[] {
    const employee = assignedTo.trim().toLowerCase();
    const assetCategory = category.trim().toLowerCase();
    if (!employee || ['stock', 'unassigned'].includes(employee) || !assetCategory) return [];
    return this.data.assets().filter(asset => asset.id !== this.eId &&
      asset.category.trim().toLowerCase() === assetCategory &&
      asset.assignedTo.trim().toLowerCase() === employee &&
      (asset.assignmentType || 'Primary').trim().toLowerCase() === 'primary');
  }
  onEditCategoryChange(v: string) { this.eCategory.set(v); }
  onEditStatusChange(status: string) {
    this.eStatus.set(status);
    this.eDepartment.set(this.departmentFor(status, this.eAssignedTo, this.eDepartment()));
  }
  setEditAssignmentType(value: string) { this.eAssignmentType.set(value === 'Temporary' ? 'Temporary' : 'Primary'); }
  onEditAssignedChange(assignedTo: string) {
    this.eAssignedTo = assignedTo;
    const assignee = assignedTo.trim().toLowerCase();
    const stock = !assignee || ['stock', 'unassigned'].includes(assignee);
    this.eStatus.set(stock ? 'In Storage' : 'In Use');
    this.eDepartment.set(this.departmentFor(this.eStatus(), assignedTo, this.eDepartment()));
  }
  private departmentFor(status: string, assignedTo: string, department: string): string {
    const assignee = assignedTo.trim().toLowerCase();
    const unassigned = !assignee || ['stock', 'unassigned'].includes(assignee.toLowerCase());
    if (unassigned && (status === 'In Storage' || status === 'Under Repair')) return 'Stock';
    if (!unassigned) {
      const rosterDepartment = this.data.employeeRoster().find(employee => employee.name.trim().toLowerCase() === assignee)?.department?.trim();
      if (rosterDepartment) return rosterDepartment;
      return 'IT';
    }
    return department;
  }
  closeAssetModal() {
    this.assetModalOpen.set(false); this.viewAsset = null; this.viewAssetId.set(null); this.newComment.set(''); this.modalError.set('');
    // Drop the ?asset= deep-link param so closing is sticky and back/refresh won't reopen.
    if (this.focusAssetId() != null) this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  // ---- Comments ----
  commentTime(ts: string) { return new Date(ts).toLocaleString(); }
  canDeleteComment(c: CommentEntry) { return this.auth.can('assets.comment') && (this.auth.isAdmin() || c.user === this.auth.currentUser()?.username); }

  async addComment() {
    const id = this.viewAssetId();
    const text = this.newComment().trim();
    if (id == null || !text || this.commentSaving()) return;
    this.commentSaving.set(true);
    const res = await this.data.addComment(id, text);
    this.commentSaving.set(false);
    if (!res.ok) { this.ui.error(res.error || 'Could not add the comment.'); return; }
    this.newComment.set('');
  }

  async deleteComment(commentId: number) {
    const id = this.viewAssetId();
    if (id == null) return;
    const ok = await this.ui.confirm({ title: 'Delete comment', message: 'Delete this comment? This cannot be undone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const res = await this.data.deleteComment(id, commentId);
    if (!res.ok) this.ui.error(res.error || 'Could not delete the comment.');
  }

  async saveEdit() {
    if (this.modalSaving()) return;
    const name = this.eName().trim();
    const serial = this.eSerial.trim();
    if (!name) { this.modalError.set('Item name is required.'); return; }
    if (!serial) { this.modalError.set('Serial number is required.'); return; }
    if (this.eAssignedTo.trim() && !this.assignableEmployees().some(employee => employee.toLowerCase() === this.eAssignedTo.trim().toLowerCase())) { this.modalError.set('Select an employee from Manage Employees or choose Stock.'); return; }
    if (this.ePurchaseDate && this.eWarrantyDate && this.eWarrantyDate < this.ePurchaseDate) { this.modalError.set('Warranty date cannot be earlier than the purchase date.'); return; }
    if (this.data.assets().some(a => a.id !== this.eId && a.serial.toLowerCase() === serial.toLowerCase())) {
      this.modalError.set(`Another asset already uses serial "${serial}".`); return;
    }
    this.modalSaving.set(true);
    const res = await this.data.updateAsset(this.eId, {
      category: this.eCategory(), name, department: this.eDepartment(), serial, assignmentType: this.eAssignmentType(),
      assignedTo: this.eAssignedTo.trim() || 'Stock', status: this.eStatus(),
      purchaseDate: this.ePurchaseDate, warrantyDate: this.eWarrantyDate
    });
    this.modalSaving.set(false);
    if (!res.ok) { this.modalError.set(res.error || 'Could not update the asset.'); return; }
    this.closeAssetModal();
  }

  async applyBulkStatus() {
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
  async bulkDelete() {
    if (!this.auth.can('assets.delete')) return;
    const ok = await this.ui.confirm({ title: 'Delete assets', message: `Delete ${this.selected().size} asset(s)? This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const count = await this.data.bulkDelete(this.selected());
    this.selected.set(new Set());
    this.ui.success(`Deleted ${count} asset(s).`);
  }
  async deleteAsset(id: number) {
    if (!this.auth.can('assets.delete')) return;
    const asset = this.data.assets().find(a => a.id === id);
    const label = asset ? `"${asset.name}" (${asset.serial})` : 'this asset';
    const ok = await this.ui.confirm({ title: 'Delete asset', message: `Delete ${label}? This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const res = await this.data.deleteAsset(id);
    if (!res.ok) this.ui.error(res.error || 'Could not delete the asset.');
    else this.ui.success('Asset deleted.');
  }

  showQr(name: string, serial: string) { this.ui.showQr(name, serial); }

  exportExcel() { exportXlsx(this.filtered(), 'Dashboard', 'AssetFlow_Filtered_Dashboard.xlsx'); }
}
