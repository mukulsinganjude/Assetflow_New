import { Routes } from '@angular/router';
import { sectionGuard } from './guards/guards';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', canActivate: [sectionGuard], loadComponent: () => import('./components/dashboard/dashboard.component').then(m => m.DashboardComponent) },
  { path: 'entry', canActivate: [sectionGuard], loadComponent: () => import('./components/entry/entry.component').then(m => m.EntryComponent) },
  { path: 'dropdowns', canActivate: [sectionGuard], loadComponent: () => import('./components/dropdown-manager/dropdown-manager.component').then(m => m.DropdownManagerComponent) },
  { path: 'desk-setup', canActivate: [sectionGuard], loadComponent: () => import('./components/desk-setup/desk-setup.component').then(m => m.DeskSetupComponent) },
  { path: 'links', canActivate: [sectionGuard], loadComponent: () => import('./components/links/links.component').then(m => m.LinksComponent) },
  { path: 'employees', canActivate: [sectionGuard], loadComponent: () => import('./components/employees/employees.component').then(m => m.EmployeesComponent) },
  { path: 'employees/:name', canActivate: [sectionGuard], loadComponent: () => import('./components/employee-detail/employee-detail.component').then(m => m.EmployeeDetailComponent) },
  { path: 'manage-employees', canActivate: [sectionGuard], loadComponent: () => import('./components/manage-employees/manage-employees.component').then(m => m.ManageEmployeesComponent) },
  { path: 'former-employees', canActivate: [sectionGuard], loadComponent: () => import('./components/former-employees/former-employees.component').then(m => m.FormerEmployeesComponent) },
  { path: 'dell-cases', canActivate: [sectionGuard], loadComponent: () => import('./components/dell-cases/dell-cases.component').then(m => m.DellCasesComponent) },
  { path: 'returns', canActivate: [sectionGuard], loadComponent: () => import('./components/returns/returns.component').then(m => m.ReturnsComponent) },
  { path: 'warranty', canActivate: [sectionGuard], loadComponent: () => import('./components/warranty/warranty.component').then(m => m.WarrantyComponent) },
  { path: 'consumables', canActivate: [sectionGuard], loadComponent: () => import('./components/consumables/consumables.component').then(m => m.ConsumablesComponent) },
  { path: 'users', canActivate: [sectionGuard], loadComponent: () => import('./components/users/users.component').then(m => m.UsersComponent) },
  { path: 'logs', canActivate: [sectionGuard], loadComponent: () => import('./components/logs/logs.component').then(m => m.LogsComponent) },
  { path: '**', redirectTo: 'dashboard' }
];
