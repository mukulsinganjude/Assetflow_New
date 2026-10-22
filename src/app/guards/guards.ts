import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UiService } from '../services/ui.service';

export const adminGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  // Keep the login overlay available while logged out; redirecting the initial
  // /dashboard navigation to itself creates an endless guard redirect.
  if (!auth.isLoggedIn()) return true;
  const segment = route.routeConfig?.path || '';
  const permission = segment === 'users' ? 'users.manage' : segment === 'consumables' ? 'consumables.view' : 'employeeDirectory.view';
  if (auth.can(permission)) return true;
  inject(UiService).error('Your account does not have permission to open this section.');
  return router.createUrlTree(['/dashboard']);
};

export const entryGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isLoggedIn()) return true;
  const segment = route.routeConfig?.path || '';
  const permission = segment === 'entry' ? 'assets.view'
    : segment === 'desk-setup' ? 'deskSetup.view'
      : segment === 'dell-cases' ? 'dellCases.view'
        : segment === 'returns' ? 'offboarding.view'
          : 'assets.view';
  if (auth.can(permission)) return true;
  return router.createUrlTree(['/dashboard']);
};

/** Protect direct navigation as well as links in the sidebar for individually granted tabs. */
export const sectionGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  // The app shell renders its login overlay outside the router outlet. Let the
  // initial route settle so that overlay can render before the user signs in.
  if (!auth.isLoggedIn()) return true;
  const segment = route.routeConfig?.path || '';
  const permission = segment === 'dashboard' ? 'dashboard.view'
    : segment === 'entry' ? 'assets.view'
      : segment === 'dropdowns' ? 'dropdowns.view'
        : segment === 'desk-setup' ? 'deskSetup.view'
        : segment === 'links' ? 'links.view'
          : segment.startsWith('employees') ? 'employees.view'
            : segment === 'manage-employees' ? 'employeeDirectory.view'
              : segment === 'former-employees' ? 'formerEmployees.view'
                : segment === 'dell-cases' ? 'dellCases.view'
                  : segment === 'returns' ? 'offboarding.view'
                    : segment === 'warranty' ? 'warranty.view'
                      : segment === 'consumables' ? 'consumables.view'
                        : segment === 'users' ? 'users.manage'
                          : segment === 'logs' ? 'activity.view' : '';
  const allowed = segment.startsWith('employees')
    ? auth.canAny('employees.view', 'employeeDirectory.view')
    : !!permission && auth.can(permission);
  if (allowed) return true;
  inject(UiService).error('Your account does not have permission to open this section.');
  return router.createUrlTree(['/dashboard']);
};
