import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DataService, DEPARTMENTS, STATUSES } from '../../services/data.service';
import { Asset } from '../../models/models';
import { exportXlsx } from '../../services/util';

interface HealthIssue {
  key: string;
  title: string;
  description: string;
  icon: string;
  /** Tailwind accent colour token, e.g. 'rose', 'amber'. */
  tone: 'rose' | 'amber' | 'sky';
  assets: Asset[];
  /** Optional per-asset detail line (e.g. the duplicated serial). */
  detail?: (a: Asset) => string;
}

@Component({
  selector: 'app-data-health',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './data-health.component.html'
})
export class DataHealthComponent {
  expanded = signal<Set<string>>(new Set());

  constructor(public data: DataService) {
    // Assets are loaded globally on login, but refresh to be safe on deep-link.
    if (this.data.assets().length === 0) this.data.loadAssets();
  }

  private hasAssignee(a: Asset): boolean {
    return !!a.assignedTo && !['stock', 'unassigned'].includes(a.assignedTo.trim().toLowerCase());
  }

  /** Serials (lowercased) that appear on more than one asset. */
  private duplicateSerials = computed<Set<string>>(() => {
    const counts = new Map<string, number>();
    for (const a of this.data.assets()) {
      const s = (a.serial || '').toLowerCase();
      if (!s) continue;
      counts.set(s, (counts.get(s) || 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([s]) => s));
  });

  issues = computed<HealthIssue[]>(() => {
    const assets = this.data.assets();
    const dups = this.duplicateSerials();
    return [
      {
        key: 'dup-serial',
        title: 'Duplicate serial numbers',
        description: 'The same serial is registered on more than one asset — one is likely a data-entry mistake.',
        icon: 'fa-clone', tone: 'rose',
        assets: assets.filter(a => a.serial && dups.has(a.serial.toLowerCase())),
        detail: (a) => `Serial: ${a.serial}`
      },
      {
        key: 'inuse-noassignee',
        title: '“In Use” with no assignee',
        description: 'Marked In Use but not assigned to anyone — either assign it or change the status.',
        icon: 'fa-user-slash', tone: 'amber',
        assets: assets.filter(a => a.status === 'In Use' && !this.hasAssignee(a))
      },
      {
        key: 'missing-warranty',
        title: 'Missing warranty date',
        description: 'No warranty expiry recorded, so these assets are invisible to the warranty forecast.',
        icon: 'fa-shield-halved', tone: 'sky',
        assets: assets.filter(a => !a.warrantyDate)
      },
      {
        key: 'missing-purchase',
        title: 'Missing purchase date',
        description: 'No purchase date recorded — useful for depreciation and lifecycle reporting.',
        icon: 'fa-calendar-xmark', tone: 'sky',
        assets: assets.filter(a => !a.purchaseDate)
      },
      {
        key: 'orphaned',
        title: 'Orphaned / invalid records',
        description: 'Category, department or status is outside the known list — likely from an old import.',
        icon: 'fa-triangle-exclamation', tone: 'rose',
        assets: assets.filter(a =>
          !this.data.categories().includes(a.category) || !DEPARTMENTS.includes(a.department) || !STATUSES.includes(a.status)),
        detail: (a) => `Category: ${a.category || '—'} · Dept: ${a.department || '—'} · Status: ${a.status || '—'}`
      }
    ];
  });

  totalAssets = computed(() => this.data.assets().length);
  /** Distinct assets flagged by at least one check. */
  affectedCount = computed(() => {
    const ids = new Set<number>();
    for (const iss of this.issues()) for (const a of iss.assets) ids.add(a.id);
    return ids.size;
  });
  totalIssues = computed(() => this.issues().reduce((n, i) => n + i.assets.length, 0));
  cleanIssues = computed(() => this.issues().filter(i => i.assets.length === 0).length);

  /** 0–100 cleanliness score: share of assets with no flags (100 when there are no assets). */
  healthScore = computed(() => {
    const total = this.totalAssets();
    if (total === 0) return 100;
    return Math.round(((total - this.affectedCount()) / total) * 100);
  });
  scoreTone = computed(() => {
    const s = this.healthScore();
    return s >= 90 ? 'emerald' : s >= 70 ? 'amber' : 'rose';
  });

  toggle(key: string) {
    const next = new Set(this.expanded());
    if (next.has(key)) next.delete(key); else next.add(key);
    this.expanded.set(next);
  }
  isExpanded(key: string) { return this.expanded().has(key); }

  // Static class maps so Tailwind's JIT scanner sees the full class strings
  // (dynamically-built `text-${tone}-500` strings would be purged).
  iconClass(tone: string): string {
    return tone === 'rose' ? 'bg-rose-500/15 text-rose-500'
      : tone === 'amber' ? 'bg-amber-500/15 text-amber-500'
      : 'bg-sky-500/15 text-sky-500';
  }
  countClass(tone: string, count: number): string {
    if (count === 0) return 'text-emerald-500';
    return tone === 'rose' ? 'text-rose-500' : tone === 'amber' ? 'text-amber-500' : 'text-sky-500';
  }
  scoreClass(): string {
    const t = this.scoreTone();
    return t === 'emerald' ? 'text-emerald-500' : t === 'amber' ? 'text-amber-500' : 'text-rose-500';
  }
  scoreRingClass(): string {
    const t = this.scoreTone();
    return t === 'emerald' ? 'border-emerald-500/40' : t === 'amber' ? 'border-amber-500/40' : 'border-rose-500/40';
  }

  exportIssues() {
    const rows: any[] = [];
    for (const iss of this.issues()) {
      for (const a of iss.assets) {
        rows.push({ 'Issue': iss.title, 'Asset': a.name, 'Serial': a.serial, 'Assigned To': a.assignedTo, 'Status': a.status, 'Detail': iss.detail ? iss.detail(a) : '' });
      }
    }
    if (rows.length === 0) { rows.push({ 'Issue': 'No issues found', 'Asset': '', 'Serial': '', 'Assigned To': '', 'Status': '', 'Detail': '' }); }
    exportXlsx(rows, 'DataHealth', 'AssetFlow_Data_Health.xlsx');
  }
}
