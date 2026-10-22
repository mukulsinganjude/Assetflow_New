import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { User } from '../models/models';
import { ApiService, errorMessage } from './api.service';
import { DataService } from './data.service';
import { TOKEN_KEY, USER_KEY } from './auth.interceptor';
import { roleDefaultPermissions } from './permissions';

interface LoginResponse { token: string; user: User; }
export interface ProfileChanges {
  email?: string;
  displayName?: string;
  profileImage: string | null;
  currentPassword?: string;
  newPassword?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private data = inject(DataService);

  currentUser = signal<User | null>(this.loadCurrent());
  isAdmin = computed(() => this.currentUser()?.role === 'admin');
  isViewer = computed(() => !this.canAny('assets.add', 'assets.edit', 'assets.assign', 'dellCases.add', 'dellCases.edit', 'deskSetup.add', 'deskSetup.edit', 'consumables.add', 'consumables.edit', 'offboarding.start', 'employeeDirectory.add', 'employeeDirectory.edit', 'links.add', 'warranty.edit'));
  isLoggedIn = computed(() => this.currentUser() !== null);

  can(permission: string): boolean {
    const user = this.currentUser();
    if (!user) return false;
    if (user.role === 'admin') return true;
    const permissions = user.permissions == null ? roleDefaultPermissions(user.role) : user.permissions;
    return permissions.includes(permission) || (permission === 'dropdowns.view' && permissions.includes('dropdowns.manage'));
  }
  canAny(...permissions: string[]): boolean { return permissions.some(permission => this.can(permission)); }

  constructor() {
    // Restore an existing session on reload: if a token is present, pull data.
    if (this.currentUser()) {
      this.data.loadAssets(); this.data.loadEmployeeComments(); this.data.loadEmployees(); this.data.loadDellCases(); this.data.loadDropdownOptions();
      this.refreshCurrentUser();
    }
  }

  async refreshCurrentUser(): Promise<void> {
    const expectedUsername = this.currentUser()?.username;
    if (!expectedUsername) return;
    try {
      const user = await firstValueFrom(this.api.get<User>('/auth/profile'));
      if (this.currentUser()?.username !== expectedUsername) return;
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      this.currentUser.set(user);
    } catch {
      // Keep the cached identity if the profile service is temporarily unavailable.
    }
  }

  syncCurrentUser(user: User): void {
    if (this.currentUser()?.username !== user.username) return;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.currentUser.set(user);
  }

  private loadCurrent(): User | null {
    try {
      // Require BOTH the token and the cached user; a stale user record without a
      // token would otherwise restore a "logged in" UI whose every request 401s.
      if (!localStorage.getItem(TOKEN_KEY)) return null;
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  }

  async login(email: string, pass: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await firstValueFrom(
        this.api.post<LoginResponse>('/auth/login', { email: email.trim().toLowerCase(), pass })
      );
      localStorage.setItem(TOKEN_KEY, res.token);
      localStorage.setItem(USER_KEY, JSON.stringify(res.user));
      this.currentUser.set(res.user);
      await this.data.loadAssets();
      await this.data.loadDropdownOptions();
      this.data.loadEmployeeComments();
      this.data.loadEmployees();
      this.data.loadDellCases();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errorMessage(e, 'Invalid company email or password.') };
    }
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.currentUser.set(null);
    // Drop all cached data so it can't leak into the next login on this tab.
    this.data.clearAll();
  }

  async updateProfile(changes: ProfileChanges): Promise<{ ok: boolean; error?: string }> {
    try {
      const user = await firstValueFrom(this.api.put<User>('/auth/profile', changes));
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      this.currentUser.set(user);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errorMessage(e, 'Could not update your profile.') };
    }
  }

}
