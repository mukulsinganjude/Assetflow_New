import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * Thin wrapper over HttpClient that prefixes every call with /api.
 * In dev, ng serve proxies /api -> http://localhost:3000 (see proxy.conf.json).
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = '/https://assetflow-new-111.onrender.com/api';

  get<T>(path: string): Observable<T> {
    return this.http.get<T>(this.base + path);
  }
  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(this.base + path, body);
  }
  put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<T>(this.base + path, body);
  }
  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(this.base + path);
  }
}

/** Pull a human-readable message out of a failed HTTP call. */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'Cannot reach the server. Is the backend running?';
    // Some errors arrive as a plain string body rather than { error: string }.
    if (typeof e.error === 'string' && e.error.trim()) return e.error.trim();
    return e.error?.error || fallback;
  }
  return fallback;
}
