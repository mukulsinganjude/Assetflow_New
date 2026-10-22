import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { AuthService } from '../../services/auth.service';
import { UiService } from '../../services/ui.service';
import { Asset, CommentEntry, DellCase } from '../../models/models';
import { EmojiPickerComponent } from './emoji-picker.component';

@Component({
  selector: 'app-dell-case-popup',
  standalone: true,
  imports: [CommonModule, FormsModule, EmojiPickerComponent],
  template: `
    <div *ngIf="record() as row" class="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xl flex items-center justify-center p-4" (click)="closed.emit()">
      <section class="glass-card w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 md:p-8 shadow-2xl" role="dialog" aria-modal="true" [attr.aria-label]="isNewCase() ? 'Raise Dell case' : 'Dell case ' + row.caseId" (click)="$event.stopPropagation()">
        <div class="flex items-start justify-between gap-4 mb-5">
          <div><h2 class="text-lg font-black text-slate-900 dark:text-white">{{ isNewCase() ? 'Raise Dell case' : 'Dell case ' + row.caseId }}</h2><p class="text-xs text-slate-500 dark:text-slate-400 mt-1">{{ isNewCase() ? 'Case details for this asset.' : 'Case details linked to this asset.' }}</p></div>
          <button type="button" (click)="closed.emit()" class="text-slate-400 hover:text-rose-400" aria-label="Close Dell case details"><i class="fa-solid fa-xmark"></i></button>
        </div>

        <div *ngIf="isNewCase() && !editingCase()" class="mb-4 flex flex-col gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-700 dark:text-amber-300 sm:flex-row sm:items-center sm:justify-between"><span><i class="fa-solid fa-circle-exclamation mr-2"></i>Please raise the Dell case for this asset.</span><a href="https://www.dell.com/support/incidents-online/en-in/srsearch" target="_blank" rel="noopener noreferrer" class="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border border-amber-400/40 px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-500/10 dark:text-amber-200 sm:self-auto"><i class="fa-solid fa-arrow-up-right-from-square"></i>Open Dell Service Request</a></div>
        <div *ngIf="!editingCase()" class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div><span class="block text-[10px] font-bold uppercase text-slate-500">Employee</span><span class="font-semibold">{{ row.employeeName }}</span></div>
          <div><span class="block text-[10px] font-bold uppercase text-slate-500">Status</span><span class="inline-block mt-1 px-2.5 py-1 rounded-lg text-xs font-bold" [ngClass]="statusClass(row.status)">{{ row.status }}</span></div>
          <div><span class="block text-[10px] font-bold uppercase text-slate-500">Category</span><span>{{ row.category || categoryForModel(row.assetModel) || '—' }}</span></div>
          <div><span class="block text-[10px] font-bold uppercase text-slate-500">Item model / name</span><span>{{ row.assetModel }}</span></div>
          <div><span class="block text-[10px] font-bold uppercase text-slate-500">Asset serial</span><span class="font-mono">{{ row.assetSerial }}</span></div>
          <div><span class="block text-[10px] font-bold uppercase text-slate-500">Registered</span><span>{{ date(row.registeredDate) }}</span></div>
          <div><span class="block text-[10px] font-bold uppercase text-slate-500">Registered by</span><span>{{ row.registeredBy }}</span></div>
          <div class="sm:col-span-2"><span class="block text-[10px] font-bold uppercase text-slate-500">Issue</span><p class="whitespace-pre-wrap break-words mt-1">{{ row.issueDescription }}</p></div>
        </div>

        <form *ngIf="editingCase()" (ngSubmit)="saveCase(row)" class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label class="space-y-1"><span class="font-bold uppercase text-slate-500">Employee</span><input class="glass-input w-full rounded-xl px-3 py-2" [ngModel]="draft().employeeName" (ngModelChange)="patchDraft('employeeName', $event)" name="employeeName" required></label>
          <label class="space-y-1"><span class="font-bold uppercase text-slate-500">Status</span><select class="glass-input w-full rounded-xl px-3 py-2" [ngModel]="draft().status" (ngModelChange)="patchDraft('status', $event)" name="status"><option>Unresolved</option><option>Resolved</option><option>Closed without resolved</option></select></label>
          <label class="space-y-1"><span class="font-bold uppercase text-slate-500">Category</span><input class="glass-input w-full rounded-xl px-3 py-2" [ngModel]="draft().category" (ngModelChange)="patchDraft('category', $event)" name="category"></label>
          <label class="space-y-1"><span class="font-bold uppercase text-slate-500">Item model / name</span><input class="glass-input w-full rounded-xl px-3 py-2" [ngModel]="draft().assetModel" (ngModelChange)="patchDraft('assetModel', $event)" name="assetModel" required></label>
          <label class="space-y-1"><span class="font-bold uppercase text-slate-500">Asset serial</span><input class="glass-input w-full rounded-xl px-3 py-2" [ngModel]="draft().assetSerial" (ngModelChange)="patchDraft('assetSerial', $event)" name="assetSerial" required></label>
          <label class="space-y-1"><span class="font-bold uppercase text-slate-500">Registered date</span><input type="date" class="glass-input w-full rounded-xl px-3 py-2" [ngModel]="draft().registeredDate" (ngModelChange)="patchDraft('registeredDate', $event)" name="registeredDate" required></label>
          <label class="space-y-1"><span class="font-bold uppercase text-slate-500">Registered by</span><input class="glass-input w-full rounded-xl px-3 py-2" [ngModel]="draft().registeredBy" (ngModelChange)="patchDraft('registeredBy', $event)" name="registeredBy" required></label>
          <label class="space-y-1"><span class="font-bold uppercase text-slate-500">Case ID</span><input class="glass-input w-full rounded-xl px-3 py-2" [ngModel]="draft().caseId" (ngModelChange)="patchDraft('caseId', $event)" name="caseId" required></label>
          <label class="sm:col-span-2 space-y-1"><span class="font-bold uppercase text-slate-500">Issue description</span><textarea rows="3" class="glass-input w-full rounded-xl px-3 py-2" [ngModel]="draft().issueDescription" (ngModelChange)="patchDraft('issueDescription', $event)" name="issueDescription" required></textarea></label>
          <p *ngIf="formError()" class="sm:col-span-2 text-rose-500">{{ formError() }}</p>
        </form>

        <div class="mt-5 pt-4 border-t border-slate-200/50 dark:border-white/10">
          <h3 class="text-xs font-bold uppercase tracking-wide text-slate-500"><i class="fa-solid fa-comment mr-1 text-indigo-400"></i> Comments <span class="ml-1 px-2 py-0.5 rounded-full bg-slate-500/10">{{ row.comments?.length || 0 }}</span></h3>
          <div class="max-h-48 overflow-y-auto space-y-2 mt-3">
            <p *ngIf="!row.comments?.length" class="text-xs italic text-slate-500 py-1">No comments yet. Be the first to add one.</p>
            <article *ngFor="let c of row.comments" class="rounded-xl bg-slate-500/5 p-3">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1"><p class="text-[11px] font-bold text-slate-500">{{ data.displayNameFor(c.authorName || c.user) }} · {{ commentTime(c.ts) }} <span *ngIf="c.editedTs" class="italic">(edited)</span></p>
                  <p *ngIf="editingId() !== c.id" class="text-sm whitespace-pre-wrap break-words mt-1">{{ c.text }}</p>
                  <div *ngIf="editingId() === c.id" class="mt-2 space-y-2"><div class="flex items-end gap-2"><textarea rows="2" maxlength="500" class="glass-input flex-1 rounded-xl px-3 py-2 text-sm" [ngModel]="editText()" (ngModelChange)="editText.set($event)" [ngModelOptions]="{standalone:true}"></textarea><app-emoji-picker [text]="editText()" (textChange)="editText.set($event)"></app-emoji-picker></div><div class="flex justify-end gap-2"><button type="button" class="px-3 py-1 rounded-lg" (click)="cancelEdit()">Cancel</button><button type="button" class="bg-blue-600 text-white px-3 py-1 rounded-lg disabled:opacity-50" [disabled]="editSaving() || !editText().trim()" (click)="saveCommentEdit(row.id, c)">Save</button></div></div>
                </div>
                <div *ngIf="canModify(c) && editingId() !== c.id" class="flex gap-2"><button type="button" (click)="startEdit(c)" aria-label="Edit comment" title="Edit comment" class="text-slate-400 hover:text-blue-500"><i class="fa-solid fa-pen text-xs"></i></button><button type="button" (click)="removeComment(row.id,c)" aria-label="Delete comment" title="Delete comment" class="text-slate-400 hover:text-rose-500"><i class="fa-solid fa-trash-can text-xs"></i></button></div>
              </div>
            </article>
          </div>
          <div *ngIf="canWrite" class="flex items-end gap-2 mt-3">
            <textarea rows="2" maxlength="500" placeholder="Add a comment..." aria-label="Add a comment" class="glass-input flex-1 rounded-xl px-3 py-2 text-sm resize-none" [ngModel]="newComment()" (ngModelChange)="newComment.set($event)" [ngModelOptions]="{standalone:true}"></textarea>
            <app-emoji-picker [text]="newComment()" (textChange)="newComment.set($event)"></app-emoji-picker>
            <button type="button" (click)="addComment(row.id)" [disabled]="savingComment() || !newComment().trim()" class="bg-blue-600 text-white w-10 h-10 rounded-xl disabled:opacity-50" title="Post comment" aria-label="Post comment"><i class="fa-solid" [ngClass]="savingComment() ? 'fa-spinner fa-spin' : 'fa-paper-plane'"></i></button>
          </div>
          <p *ngIf="!canWrite" class="text-[11px] text-slate-500 text-center mt-2">You have read-only access to comments.</p>
        </div>

        <div class="flex justify-end gap-2 pt-4 mt-4 border-t border-slate-200/50 dark:border-white/10">
          <button *ngIf="editingCase()" type="button" (click)="editingCase.set(false); formError.set('')" class="glass-card px-4 py-2 rounded-xl text-xs font-semibold">Cancel</button>
          <button type="button" (click)="closed.emit()" class="glass-card px-4 py-2 rounded-xl text-xs font-semibold">Close</button>
          <button *ngIf="canCreateCase() && !editingCase() && isNewCase()" type="button" (click)="beginCreateCase()" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-semibold"><i class="fa-solid fa-plus mr-1"></i>Create Case</button>
          <button *ngIf="canEditCase() && !editingCase() && !isNewCase()" type="button" (click)="startCaseEdit(row)" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-semibold"><i class="fa-solid fa-pen-to-square mr-1"></i>Edit</button>
          <button *ngIf="(isNewCase() ? canCreateCase() : canEditCase()) && editingCase()" type="button" (click)="saveCase(row)" [disabled]="savingCase()" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"><i class="fa-solid" [ngClass]="savingCase() ? 'fa-spinner fa-spin' : (isNewCase() ? 'fa-plus' : 'fa-check')"></i> {{ isNewCase() ? 'Create Case' : 'Save changes' }}</button>
        </div>
      </section>
    </div>
  `
})
export class DellCasePopupComponent {
  private _caseId = signal<number | null>(null);
  private _newCaseAsset = signal<Asset | null>(null);
  @Input() set caseId(value: number | null) { this._caseId.set(value); if (value != null) { this._newCaseAsset.set(null); this.editingCase.set(false); } this.formError.set(''); }
  @Input() set newCaseAsset(asset: Asset | null) {
    this._newCaseAsset.set(asset);
    if (asset) {
      const user = this.auth.currentUser();
      this.draft.set({ id: 0, employeeName: asset.assignedTo || 'Stock', category: asset.category, assetModel: asset.name, assetSerial: asset.serial, registeredDate: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10), caseId: '', issueDescription: '', registeredBy: user?.displayName?.trim() && user.displayName.trim() !== user.username ? user.displayName.trim() : '', status: 'Unresolved', updatedAt: new Date().toISOString(), comments: [] });
      this.editingCase.set(false); this.formError.set('');
    }
  }
  @Output() closed = new EventEmitter<void>();
  record = computed<DellCase | null>(() => this.data.dellCases().find(row => row.id === this._caseId()) ?? (this._newCaseAsset() ? { ...this.draft(), id: 0 } as DellCase : null));
  editingCase = signal(false);
  draft = signal<Partial<DellCase>>({});
  formError = signal('');
  savingCase = signal(false);
  newComment = signal('');
  savingComment = signal(false);
  editingId = signal<number | null>(null);
  editText = signal('');
  editSaving = signal(false);

  constructor(public data: DataService, public auth: AuthService, private ui: UiService) {}

  get canWrite() { return this.auth.can('dellCases.comment'); }
  canCreateCase() { return this.auth.can('dellCases.add'); }
  canEditCase() { return this.auth.can('dellCases.edit'); }
  isNewCase() { return this._newCaseAsset() != null; }
  canModify(c: CommentEntry) { return this.canWrite && (this.auth.isAdmin() || c.user === this.auth.currentUser()?.username); }
  categoryForModel(model: string): string {
    for (const [category, models] of Object.entries(this.data.catalog())) if (models.includes(model)) return category;
    return this.data.assets().find(asset => asset.name === model)?.category || '';
  }
  date(value: string) { return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '—'; }
  commentTime(ts: string) { return new Date(ts).toLocaleString(); }
  statusClass(status: string) { return status === 'Resolved' ? 'bg-emerald-500/10 text-emerald-500' : status === 'Unresolved' ? 'bg-amber-500/10 text-amber-500' : 'bg-slate-500/10 text-slate-500'; }
  patchDraft<K extends keyof DellCase>(key: K, value: DellCase[K]) { this.draft.update(current => ({ ...current, [key]: value })); }
  startCaseEdit(row: DellCase) { if (!this.canEditCase()) return; this.draft.set({ ...row }); this.formError.set(''); this.editingCase.set(true); }
  beginCreateCase() { if (!this.canCreateCase()) return; this.formError.set(''); this.editingCase.set(true); }

  async saveCase(row: DellCase) {
    if ((this.isNewCase() ? !this.canCreateCase() : !this.canEditCase()) || this.savingCase()) return;
    const d = this.draft();
    const required: (keyof DellCase)[] = ['employeeName', 'assetModel', 'assetSerial', 'registeredDate', 'caseId', 'issueDescription', 'registeredBy'];
    if (required.some(key => !String(d[key] ?? '').trim())) { this.formError.set('Please complete all required fields.'); return; }
    this.savingCase.set(true); this.formError.set('');
    const isNew = this._newCaseAsset() != null;
    const payload: Partial<DellCase> = { ...row, ...d };
    if (isNew) delete payload.id;
    const result = await this.data.saveDellCase(payload);
    this.savingCase.set(false);
    if (!result.ok) { this.formError.set(result.error || 'Could not update the case.'); return; }
    this.editingCase.set(false); this._newCaseAsset.set(null); this.ui.success(isNew ? 'Dell case registered.' : 'Dell case updated.');
  }

  async addComment(id: number) {
    const text = this.newComment().trim(); if (!text || this.savingComment()) return;
    this.savingComment.set(true); const result = await this.data.addDellCaseComment(id, text); this.savingComment.set(false);
    if (!result.ok) { this.ui.error(result.error || 'Could not add the comment.'); return; }
    this.newComment.set('');
  }
  startEdit(c: CommentEntry) { this.editingId.set(c.id); this.editText.set(c.text); }
  cancelEdit() { this.editingId.set(null); this.editText.set(''); }
  async saveCommentEdit(caseId: number, c: CommentEntry) {
    const text = this.editText().trim(); if (!text || this.editSaving()) return;
    this.editSaving.set(true); const result = await this.data.editDellCaseComment(caseId, c.id, text); this.editSaving.set(false);
    if (!result.ok) { this.ui.error(result.error || 'Could not update the comment.'); return; }
    this.cancelEdit();
  }
  async removeComment(caseId: number, c: CommentEntry) {
    const ok = await this.ui.confirm({ title: 'Delete comment', message: 'Delete this comment? This cannot be undone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const result = await this.data.deleteDellCaseComment(caseId, c.id);
    if (!result.ok) this.ui.error(result.error || 'Could not delete the comment.');
  }
}
