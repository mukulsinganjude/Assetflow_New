import { Component, computed, ElementRef, effect, HostListener, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './services/auth.service';
import { ThemeService } from './services/theme.service';
import { DataService } from './services/data.service';
import { UiService } from './services/ui.service';
import { PresenceService } from './services/presence.service';
import { ApiService } from './services/api.service';
import { ThemeSettingsComponent } from './components/theme-settings/theme-settings.component';
import { Asset, HistoryEntry } from './models/models';

declare const QRCode: any;

type CommandOption = { kind: 'page' | 'asset' | 'employee' | 'checkin' | 'checkout'; label: string; detail: string; icon: string; route?: string; assetId?: number; employee?: string };
type SidebarItem = { id: string; label: string; route: string; icon: string; iconColor: string; adminOnly?: boolean; writeOnly?: boolean };
/** A history event joined with the asset it belongs to — one notification row. */
type ActivityEvent = HistoryEntry & { asset: Asset };

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive, ThemeSettingsComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  guideOpen = false;
  guideMobileNavOpen = false;
  selectedGuideTab = 'Dashboard';
  guideSearch = signal('');
  readonly websiteWorkflowTree = [
    'Open AssetFlow',
    '└── Sign in with company email and password',
    '    ├── Login succeeds',
    '    │   ├── Dashboard — overview and shortcuts',
    '    │   ├── Assets',
    '    │   │   ├── Asset Entry — add, edit, assign, import, export assets',
    '    │   │   ├── Desk Setup — track equipment by desk',
    '    │   │   └── Consumables — track quantities, thresholds, and adjustments',
    '    │   ├── Employees — find people and view assigned equipment',
    '    │   │   └── Employee details — equipment, history, and comments',
    '    │   ├── Manage Employees [admin] — maintain the employee directory',
    '    │   ├── Offboarding Returns — checklist and equipment return workflow',
    '    │   ├── Former Employees — completed departures and saved records',
    '    │   ├── Dell Cases — support cases associated with equipment',
    '    │   ├── Warranty & Forecast — coverage dates and warranty updates',
    '    │   ├── Links — shared work links',
    '    │   ├── Activity Trail — searchable audit history',
    '    │   ├── User Roles [admin] — accounts, roles, and user-specific access',
    '    │   ├── Global header — online tracker, notifications, and profile',
    '    │   └── Help button — tab guide, examples, field snapshots, and notes',
    '    └── Login fails',
    '        └── Show an error; check company email, password, and API availability'
  ].join('\n');
  readonly guideNavigationTree = [
    {
      title: 'Login succeeds', icon: 'fa-circle-check', detail: 'Continue into AssetFlow. Your role and individual permissions determine which screens and actions are available.',
      children: [
        { title: 'Dashboard', detail: 'Asset overview and shortcuts.', icon: 'fa-chart-pie', children: [] },
        { title: 'Assets', detail: 'Track equipment and supplies.', icon: 'fa-boxes-stacked', children: [
          { title: 'Asset Entry', detail: 'Add, edit, assign, import, and export assets.', icon: 'fa-circle-plus' },
          { title: 'Desk Setup', detail: 'Track equipment installed at a desk.', icon: 'fa-desktop' },
          { title: 'Consumables', detail: 'Track quantities, thresholds, and stock adjustments.', icon: 'fa-boxes-stacked' }
        ] },
        { title: 'Employees', detail: 'Find people and view assigned equipment.', icon: 'fa-users', children: [
          { title: 'Employee details', detail: 'Review equipment, history, and comments.', icon: 'fa-user' }
        ] },
        { title: 'Manage Employees · Admin', detail: 'Maintain the employee directory.', icon: 'fa-user-gear', children: [] },
        { title: 'Offboarding Returns', detail: 'Run checklists and record equipment returns.', icon: 'fa-clipboard-check', children: [] },
        { title: 'Former Employees', detail: 'Review completed departures and saved records.', icon: 'fa-box-archive', children: [] },
        { title: 'Dell Cases', detail: 'Track support cases associated with equipment.', icon: 'fa-screwdriver-wrench', children: [] },
        { title: 'Warranty & Forecast', detail: 'Review coverage dates and warranty updates.', icon: 'fa-shield-halved', children: [] },
        { title: 'Links', detail: 'Open shared work resources.', icon: 'fa-link', children: [] },
        { title: 'Activity Trail', detail: 'Review searchable audit history.', icon: 'fa-clock-rotate-left', children: [] },
        { title: 'User Roles · Admin', detail: 'Manage accounts, roles, and individual access.', icon: 'fa-user-shield', children: [] },
        { title: 'Global header', detail: 'Online tracker, notifications, and profile.', icon: 'fa-bars', children: [] },
        { title: 'Help button', detail: 'Tab guide, examples, field snapshots, and useful notes.', icon: 'fa-circle-question', children: [] }
      ]
    },
    {
      title: 'Login fails', icon: 'fa-circle-exclamation', detail: 'AssetFlow displays a sign-in error.',
      children: [{ title: 'Check sign-in', detail: 'Confirm the company email and password, then check API availability if the error continues.', icon: 'fa-key', children: [] }]
    }
  ];
  readonly guideSections = [
    { title: 'Dashboard', icon: 'fa-chart-pie', access: 'Everyone', description: 'View the asset overview, current assignments, upcoming warranty dates, and quick actions.', steps: 'Use the search and filters to find equipment. Select an asset to view its details or start a check-in or check-out.' },
    { title: 'Asset Entry', icon: 'fa-circle-plus', access: 'Admins and data-entry users', description: 'Add assets to inventory, update their details, or import asset records.', steps: 'Choose Add Asset, complete the required fields (especially category, model, and serial number), then save. Use the import template for bulk uploads.' },
    { title: 'Desk Setup', icon: 'fa-desktop', access: 'Admins and data-entry users', description: 'Record monitor and docking-station setups for desks or employees.', steps: 'Search for a person or desk, add the connected peripherals, and save. Check serial numbers before adding to avoid duplicates.' },
    { title: 'Consumables', icon: 'fa-boxes-stacked', access: 'Admins', description: 'Track quantities of supplies, reorder levels, and stock changes.', steps: 'Add an item with its quantity and reorder threshold. Record stock changes when supplies arrive or are issued, and review low-stock indicators.' },
    { title: 'Employees', icon: 'fa-users', access: 'Everyone', description: 'See employees and the equipment currently assigned to them.', steps: 'Search or select an employee to review their assigned assets. Use an asset’s check-in/check-out action to record a handover.' },
    { title: 'Manage Employees', icon: 'fa-user-gear', access: 'Admins', description: 'Maintain the active employee directory and employee details.', steps: 'Add a new employee or update an existing record. Keep names and CCIDs accurate because other pages use them to link equipment.' },
    { title: 'Offboarding Returns', icon: 'fa-clipboard-check', access: 'Admins and data-entry users', description: 'Track equipment returns when an employee leaves and create a former-employee asset record.', steps: 'Find the employee and start the offboarding checklist. For each asset, record its condition and accessories, then mark it returned. Good items go to In Storage; Damaged or Needs repair items go Under Repair.' },
    { title: 'Former Employees', icon: 'fa-box-archive', access: 'Everyone', description: 'Review archived employee details and the assets captured at departure.', steps: 'Search by name or CCID. Use the eye button to open the asset snapshot and check each asset’s recorded return condition.' },
    { title: 'Dell Cases', icon: 'fa-screwdriver-wrench', access: 'Admins and data-entry users', description: 'Register and follow Dell support cases linked to assets.', steps: 'Create a case with its case ID, asset serial, issue, and status. Use comments to keep case updates together and open the asset’s case indicator for its linked case.' },
    { title: 'Warranty & Forecast', icon: 'fa-shield-halved', access: 'Everyone', description: 'Review warranty coverage and identify assets approaching warranty end.', steps: 'Use search and filters to find an asset. Check purchase and warranty dates before planning renewal or replacement.' },
    { title: 'Links', icon: 'fa-link', access: 'Everyone', description: 'Open shared company resources and commonly used websites.', steps: 'Select a saved link to open it. Admins can maintain the shared link list.' },
    { title: 'Activity Trail', icon: 'fa-clock-rotate-left', access: 'Everyone', description: 'Review recorded changes and actions across the inventory.', steps: 'Filter by date, user, or action to find an event. Use this page to trace who changed an asset or recorded a handover.' },
    { title: 'User Roles', icon: 'fa-user-shield', access: 'Admins', description: 'Create user accounts and manage access roles and job titles.', steps: 'Add or edit a user and assign the appropriate role. Viewers can inspect data; data-entry users can update operational records; admins can manage users and settings.' },
    { title: 'Workflow map', icon: 'fa-diagram-project', access: 'All users', description: 'Follow the main paths through AssetFlow, from signing in to completing common inventory, handover, and access tasks.', steps: 'Choose a workflow below and follow its arrows from one screen to the next. Each path shows where to start, what to do, and where to check the result.' }
  ];
  readonly guideWorkflowRows = [
    { title: 'Sign in and get oriented', icon: 'fa-right-to-bracket', flow: 'Company email + password → Dashboard → choose a section from the sidebar', detail: 'Use the Dashboard to search or filter assets. The help button opens this guide; the header contains online presence, notifications, and profile controls.' },
    { title: 'Add and assign equipment', icon: 'fa-laptop', flow: 'Asset Entry → Add Asset → enter model and unique serial → choose status and assignee → Save → verify on Dashboard or Employees', detail: 'Set In Storage for available stock. Set In Use and choose an active employee when assigning immediately. Add dates and department when known.' },
    { title: 'Record a handover', icon: 'fa-arrow-right-arrow-left', flow: 'Dashboard or Employees → find asset → Check out / Check in → confirm employee, assignment, condition, and accessories → Save → verify status and history', detail: 'Check out assigns available equipment. Check in records a returned item and updates its location and status.' },
    { title: 'Complete offboarding', icon: 'fa-clipboard-check', flow: 'Offboarding Returns → select employee → start checklist → inspect each asset → record condition and accessories → mark returned → Former Employees', detail: 'Good items return to In Storage. Damaged or Needs repair items move Under Repair. The completed departure record is saved for later review.' },
    { title: 'Manage people and access', icon: 'fa-user-shield', flow: 'Manage Employees → maintain directory → User Roles (admin) → select/add user → choose role → set individual permissions if needed → save', detail: 'The employee directory supplies people for assignments and offboarding. A custom user permission list replaces that user’s role defaults. Admins retain full access.' },
    { title: 'Find and export records', icon: 'fa-magnifying-glass', flow: 'Open the relevant tab → search → apply filters → review results and pagination → Export (if permitted)', detail: 'Search and filters only narrow displayed results. Use the module template for bulk changes and review validation or skipped-row messages after importing.' },
    { title: 'Track supplies and support', icon: 'fa-boxes-stacked', flow: 'Consumables → add item and threshold → adjust stock; Dell Cases → register case against asset → update status and comments', detail: 'Consumables track quantities and reorder thresholds. Dell Cases keep the support ID, affected equipment, issue, status, and follow-up notes together.' }
  ];
  readonly guideWorkflowGroups = [
    { title: 'Inventory lifecycle', items: this.guideWorkflowRows.slice(1, 3) },
    { title: 'People and access', items: [this.guideWorkflowRows[3], this.guideWorkflowRows[4]] },
    { title: 'Search and operations', items: this.guideWorkflowRows.slice(5) }
  ];
  readonly guideScreenGroups = [
    { title: 'Overview and equipment', items: [
      { name: 'Dashboard', purpose: 'See the asset overview, current assignments, upcoming warranty dates, and quick actions.', workflow: 'Search or filter equipment → open an asset for details/history → check it in or out → verify its assignee and status.' },
      { name: 'Asset Entry', purpose: 'Create and maintain individually tracked equipment.', workflow: 'Add Asset → choose category/model → enter a unique serial → set status, department, and assignee → save → verify on Dashboard.' },
      { name: 'Desk Setup', purpose: 'Record peripherals installed at desks.', workflow: 'Find a desk/person → add peripheral type, model, and serial → save → review the desk record.' },
      { name: 'Consumables', purpose: 'Track quantity-based supplies, locations, and reorder thresholds.', workflow: 'Add item and quantity → set unit/location/threshold → adjust stock when it changes → review low-stock indicators.' }
    ] },
    { title: 'People and equipment lifecycle', items: [
      { name: 'Employees', purpose: 'Find employees and see the equipment assigned to them.', workflow: 'Search by name → open employee details → review equipment/history/comments → use an allowed asset action.' },
      { name: 'Manage Employees', purpose: 'Maintain the employee directory used for assignments and offboarding.', workflow: 'Search first → add/import or edit a directory record → save → verify it appears in assignment pickers.' },
      { name: 'Offboarding Returns', purpose: 'Track a departure and recover assigned equipment.', workflow: 'Select employee → start checklist → inspect assets → record condition/accessories/notes → mark returns → complete checklist.' },
      { name: 'Former Employees', purpose: 'Review saved records after offboarding is complete.', workflow: 'Search the former employee list → inspect the saved departure snapshot → export/archive if allowed.' }
    ] },
    { title: 'Support, reporting, and access', items: [
      { name: 'Dell Cases', purpose: 'Track support cases connected to assets and employees.', workflow: 'Add case → link equipment/person → enter case ID, date, issue, and status → add progress comments → update or close.' },
      { name: 'Warranty & Forecast', purpose: 'Review coverage dates and upcoming warranty risk.', workflow: 'Filter by period/status → inspect an asset or case → update/import warranty information if authorized → export if allowed.' },
      { name: 'Links', purpose: 'Keep useful internal resources in one shared list.', workflow: 'Add a clearly named link and purpose → open the resource when needed → remove outdated links if permitted.' },
      { name: 'Activity Trail', purpose: 'Review actions recorded by the application.', workflow: 'Search/filter the audit list → inspect who changed what and when → export if authorized.' },
      { name: 'User Roles', purpose: 'Manage accounts, role defaults, and user-specific access.', workflow: 'Admin adds/selects a user → chooses role → optionally sets individual permissions → saves → verifies access.' },
      { name: 'Online tracker and Website Guide', purpose: 'See who is active and get contextual help.', workflow: 'Open the header online control to see names and last-updated times or hide your own presence; open the help button to browse tab instructions, workflow examples, and useful notes.' }
    ] }
  ];
  readonly guideCommonTasks = [
    { title: 'Add and assign a new asset', steps: ['Open Asset Entry or the asset shortcut on Dashboard.', 'Choose Add Asset and enter category, model, and a unique serial number.', 'Choose status and department; select an employee and assignment type if assigning now.', 'Add purchase/warranty dates and other known details, then save.', 'Check Dashboard or the employee page to confirm the asset and assignment.'] },
    { title: 'Check an asset out or back in', steps: ['Find the asset on Dashboard, Asset Entry, or the employee details page.', 'Choose check-out to assign available stock, or check-in to record its return.', 'Confirm the employee/assignment and record handover condition or accessories when prompted.', 'Save and verify the updated owner and status in the asset record.'] },
    { title: 'Offboard an employee', steps: ['Open Offboarding Returns and search for the employee.', 'Start a checklist and review outstanding equipment.', 'Inspect each item and record condition, accessories, and notes.', 'Mark each return and complete offboarding after all items are handled.', 'Review the resulting record in Former Employees.'] },
    { title: 'Add a user and control access', steps: ['An administrator opens User Roles and adds or selects the account.', 'Assign the closest default role: Admin, Data Entry, or Viewer.', 'If needed, set individual permissions; a saved override replaces that user’s role defaults.', 'Save, then have the user sign in again or refresh their profile before verifying access.'] },
    { title: 'Find or export records', steps: ['Open the relevant screen and search by a name, serial, model, or identifier.', 'Apply category, status, date, or department filters where present.', 'Check the visible results and page controls.', 'Choose Export if the account has export permission.'] }
  ];
  readonly guideReferenceNotes = [
    'Search and filters narrow displayed lists; they do not change or delete records.',
    'Asset statuses: In Use means assigned; In Storage means available stock; Under Repair means it needs repair follow-up.',
    'During offboarding, Good returns to In Storage. Damaged and Needs repair move Under Repair.',
    'Check serial numbers and other identifiers before saving or importing. Use the module import template and review skipped-row messages; use company email addresses for accounts.',
    'Export is available only where the account has permission. Review the result list and pagination before exporting.',
    'If a tab or action is missing, ask an administrator to review the role and individual permission override.',
    'The online list is shared only by sessions connected to the same API service; local and hosted sites can show separate lists.',
    'On mobile, the sidebar opens as a drawer. Close it after selecting a screen; wide tables/forms may scroll within their own panel.',
    'The left navigation can be reordered by each user; section names stay the same.',
    'Confirm employee, asset, and serial details before destructive actions. Use archive/restore tools where available; restores record who performed them in the audit trail.',
    'This guide describes the application; the current user’s role and individual access settings decide which actions are available.'
  ];
  readonly guideSupportPaths = [
    { problem: 'A screen or action is missing', next: 'Ask an administrator to check role and user-specific permissions.' },
    { problem: 'Data looks missing or outdated', next: 'Refresh and verify your search/filters, then check that you are using the right local data file.' },
    { problem: 'Sign-in or API error', next: 'Check the company email and password, then confirm the local API is running at http://localhost:3000/api/health.' },
    { problem: 'Asset or employee data is incorrect', next: 'Correct it in the module that owns the record, then review the Activity Trail.' },
    { problem: 'Need help with a task', next: 'Search this guide for the tab or task, then follow its example and steps.' }
  ];
  readonly guideStepLists: Record<string, string[]> = {
    'Dashboard': ['Use the search field to look up an asset by model, serial number, or assigned employee.', 'Use the summary cards and filters to narrow the inventory view.', 'Open an asset row for its details and history.', 'Choose Check out to assign available stock, or Check in to record a return.', 'Confirm the updated assignee and status in the asset list.'],
    'Asset Entry': ['Open Assets, then choose Asset Entry.', 'Select Add Asset and choose the matching category and model.', 'Enter the asset serial number. This should uniquely identify the physical item.', 'Choose In Storage for available stock, or In Use and an active employee for an assigned asset.', 'Add department, purchase date, and warranty date when known; save and verify the new row.'],
    'Desk Setup': ['Open Assets, then choose Desk Setup.', 'Find or select the employee or desk where the equipment is installed.', 'Add the monitor or docking station and enter its model and serial number.', 'Review the setup for duplicate devices or incorrect serials, then save.'],
    'Consumables': ['Open Assets, then choose Consumables.', 'Select Add item and enter the supply name, category, unit, and location.', 'Enter the current quantity and a reorder threshold for low-stock alerts.', 'When supplies arrive or are issued, choose Adjust stock and enter the change and reason.', 'Check the resulting quantity and low-stock indicator.'],
    'Employees': ['Open Employees and search for the person by name or CCIID.', 'Open their record to review their assigned equipment.', 'Select the relevant asset action: Check out to assign stock, or Check in to receive it back.', 'For check-out, select the employee, assignment type, condition, and accessories.', 'Confirm the action and check the updated asset assignment.'],
    'Manage Employees': ['Open Manage Employees and search first to avoid creating a duplicate record.', 'Choose Add Employee and enter the person’s display name and CCIID.', 'For an existing employee, select Edit and update the relevant fields.', 'Save, then confirm the employee appears in the directory and assignment pickers.'],
    'Offboarding Returns': ['Open Offboarding Returns and search for the departing employee.', 'Confirm the employee name and CCIID, then start the offboarding checklist.', 'For each listed asset, check the item and accessories received.', 'Choose Good, Damaged, or Needs repair, then mark the asset returned.', 'Good assets move to In Storage. Damaged and Needs repair assets move Under Repair.', 'After the last outstanding item is returned, check Former Employees for the archived snapshot.'],
    'Former Employees': ['Search for the former employee by name or CCIID.', 'Select the eye icon in the Actions column to open asset details.', 'Review each asset, its departure status, and its saved return condition.', 'Use Export if you need an offboarding snapshot report.'],
    'Dell Cases': ['Open Dell Case Register and choose Register Dell case.', 'Select the employee, asset category, model, and serial number.', 'Enter the Dell case ID, registration date, issue description, and registered-by name.', 'Set the case status, then save. Case IDs must be unique and the selected model must match the asset serial.', 'Use Comments on the case row for follow-up notes and updates.'],
    'Warranty & Forecast': ['Open Warranty & Forecast.', 'Search for an asset by model or serial, or filter the list by warranty period.', 'Review purchase and warranty dates and the remaining coverage.', 'Use approaching-expiry information to plan renewal or replacement, and verify dates against the asset record.'],
    'Links': ['Open Links to see shared company resources.', 'Select a link to open the resource.', 'If a link is missing or outdated, ask an administrator to update the shared list.'],
    'Activity Trail': ['Open Activity Trail.', 'Filter by date, user, or action to narrow the event list.', 'Review the event, affected record, and person who made the change.', 'Export the results if you need to keep or share a report.'],
    'User Roles': ['Open User Roles (available to administrators).', 'Choose Add User and enter the display name, company email, password, and access role.', 'Set the user’s job title here; profile settings do not allow users to change their title.', 'When editing, confirm the email, role, and title before saving.', 'Use the lowest access role needed: Viewer is read-only, Data Entry handles daily records, and Admin manages users and restricted settings.'],
    'Workflow map': ['Start at Dashboard after signing in, then open the section that owns the task.', 'For asset lifecycle tasks, use Asset Entry to create records, Dashboard or Employees to hand equipment over, and Offboarding Returns to recover equipment.', 'For staff and access, keep the employee directory current, then manage account roles and individual access in User Roles (admins only).', 'Use search and filters to locate records; use Activity Trail to review recorded changes.', 'Confirm the saved result in the related list or employee record.']
  };
  readonly guideExamples: Record<string, { caption: string; fields: { label: string; value: string }[] }> = {
    'Dashboard': { caption: 'Example asset details', fields: [{ label: 'Asset', value: 'Dell Latitude 5450' }, { label: 'Serial number', value: 'DL-5450-901' }, { label: 'Assigned to', value: 'Sarah Jenkins' }, { label: 'Status', value: 'In Use' }] },
    'Asset Entry': { caption: 'Example: add an asset', fields: [{ label: 'Category', value: 'Laptop' }, { label: 'Model', value: 'Dell Latitude 5450' }, { label: 'Serial number', value: 'DL-5450-901' }, { label: 'Status', value: 'In Storage' }] },
    'Desk Setup': { caption: 'Example desk equipment fields', fields: [{ label: 'Employee / desk', value: 'Sarah Jenkins · Desk 24' }, { label: 'Device type', value: 'Docking Station' }, { label: 'Model', value: 'Dell WD22TB4' }, { label: 'Serial number', value: 'DS-567888' }] },
    'Consumables': { caption: 'Example stock item', fields: [{ label: 'Item', value: 'USB-C cable' }, { label: 'Quantity', value: '24 pcs' }, { label: 'Reorder threshold', value: '5 pcs' }, { label: 'Location', value: 'IT storage' }] },
    'Employees': { caption: 'Example employee lookup', fields: [{ label: 'Employee name', value: 'Sarah Jenkins' }, { label: 'CCIID', value: 'CCI1042' }, { label: 'Assigned asset', value: 'Dell Latitude 5450' }, { label: 'Assignment', value: 'Primary · In Use' }] },
    'Manage Employees': { caption: 'Example employee record', fields: [{ label: 'Display name', value: 'Sarah Jenkins' }, { label: 'CCIID', value: 'CCI1042' }, { label: 'Department', value: 'IT' }] },
    'Offboarding Returns': { caption: 'Example return fields', fields: [{ label: 'Asset', value: 'Dell Latitude 5450' }, { label: 'Accessories', value: 'Charger · Mouse' }, { label: 'Condition on return', value: 'Needs repair' }, { label: 'Resulting status', value: 'Under Repair' }] },
    'Former Employees': { caption: 'Example archived asset snapshot', fields: [{ label: 'Former employee', value: 'Sarah Jenkins · CCI1042' }, { label: 'Asset', value: 'Dell Latitude 5450' }, { label: 'Condition at return', value: 'Damaged' }, { label: 'Left date', value: 'Oct 4, 2026' }] },
    'Dell Cases': { caption: 'Example Dell case form', fields: [{ label: 'Case ID', value: '123456789' }, { label: 'Asset serial', value: 'DL-5450-901' }, { label: 'Issue', value: 'Screen flickers after startup' }, { label: 'Status', value: 'Unresolved' }] },
    'Warranty & Forecast': { caption: 'Example warranty record', fields: [{ label: 'Asset', value: 'Dell Latitude 5450' }, { label: 'Purchase date', value: '2024-01-15' }, { label: 'Warranty date', value: '2027-01-15' }, { label: 'Coverage', value: 'Active' }] },
    'Links': { caption: 'Example shared link', fields: [{ label: 'Name', value: 'IT Service Desk' }, { label: 'Website', value: 'https://support.example.com' }, { label: 'Category', value: 'Support' }] },
    'Activity Trail': { caption: 'Example activity entry', fields: [{ label: 'Action', value: 'Asset checked out' }, { label: 'Asset serial', value: 'DL-5450-901' }, { label: 'User', value: 'Admin_Mukul' }, { label: 'Date', value: 'Oct 4, 2026 · 10:30 AM' }] },
    'User Roles': { caption: 'Example user setup', fields: [{ label: 'Display name', value: 'Jordan Lee' }, { label: 'Company email', value: 'jordan@example.com' }, { label: 'Title', value: 'IT Support' }, { label: 'Access role', value: 'Data Entry' }] },
    'Workflow map': { caption: 'Example asset lifecycle', fields: [{ label: 'Create', value: 'Asset Entry · serial DL-5450-901' }, { label: 'Assign', value: 'Dashboard · Sarah Jenkins' }, { label: 'Return', value: 'Offboarding Returns · Good' }, { label: 'Final status', value: 'In Storage · Former Employees record saved' }] }
  };
  readonly rolePermissionRows = [
    { section: 'Dashboard / Asset list', admin: 'View, add, edit, assign, import, export, delete', entry: 'View, add, edit, assign, import, export', viewer: 'View only' },
    { section: 'Asset Entry', admin: 'Full access', entry: 'Add, edit, import, export', viewer: 'No access' },
    { section: 'Desk Setup', admin: 'Add, edit, delete, import, export', entry: 'Add, edit, delete, import, export', viewer: 'No access' },
    { section: 'Consumables', admin: 'Full access, including stock changes', entry: 'No access', viewer: 'No access' },
    { section: 'Employees', admin: 'View, add/edit notes, assign equipment', entry: 'View, add/edit own notes, assign equipment', viewer: 'View only' },
    { section: 'Manage Employees', admin: 'Add, edit, import, archive, delete', entry: 'No access', viewer: 'No access' },
    { section: 'Offboarding Returns', admin: 'Start and complete return checklists', entry: 'Start and complete return checklists', viewer: 'No access' },
    { section: 'Former Employees', admin: 'View, export, archive records', entry: 'View, export, archive records', viewer: 'View and export' },
    { section: 'Dell Cases', admin: 'Add, edit, delete, import, export, comment', entry: 'Add, edit, delete, import, export, comment', viewer: 'View only' },
    { section: 'Warranty & Forecast', admin: 'View, update warranty, import, export', entry: 'View, update warranty, import, export', viewer: 'View and export' },
    { section: 'Links', admin: 'Add, import, edit/delete any link', entry: 'Add/import; delete own links', viewer: 'View only' },
    { section: 'Activity Trail', admin: 'View, filter, export, clear logs', entry: 'View, filter, export', viewer: 'View, filter, export' },
    { section: 'User Roles', admin: 'Create/edit/delete users, change roles and titles, backup/restore', entry: 'No access', viewer: 'No access' },
    { section: 'Backup and restore', admin: 'Create backups and restore records; restores are recorded', entry: 'No access', viewer: 'No access' },
    { section: 'Profile settings', admin: 'Update own profile and password', entry: 'Update own profile and password', viewer: 'Update own profile and password' }
  ];
  readonly guideNavigationItems = computed(() => {
    const pages = this.guideSections.map(item => ({ title: item.title, icon: item.icon }));
    const special = [
      { title: 'Role permissions', icon: 'fa-shield-halved' },
      { title: 'Useful notes', icon: 'fa-circle-info' }
    ];
    const query = this.guideSearch().trim().toLowerCase();
    return [...pages, ...special].filter(item => !query || this.guideSearchText(item.title).includes(query));
  });

  private guideSearchText(title: string): string {
    if (title === 'Workflow map') {
      return ['Workflow map', this.websiteWorkflowTree, ...this.guideWorkflowRows.flatMap(row => [row.title, row.flow, row.detail]), ...this.guideWorkflowGroups.map(group => group.title), ...this.guideScreenGroups.flatMap(group => [group.title, ...group.items.flatMap(item => [item.name, item.purpose, item.workflow])]), ...this.guideCommonTasks.flatMap(task => [task.title, ...task.steps]), ...this.guideReferenceNotes, ...this.guideSupportPaths.flatMap(path => [path.problem, path.next]), ...(this.guideStepLists['Workflow map'] || [])].join(' ').toLowerCase();
    }
    if (title === 'Role permissions') {
      return ['Role permissions', ...this.rolePermissionRows.flatMap(row => [row.section, row.admin, row.entry, row.viewer]),
        'Admin Data Entry Viewer full access read only add edit delete import export manage users backup restore'].join(' ').toLowerCase();
    }
    if (title === 'Useful notes') {
      return 'Useful notes In Use In Storage Under Repair Good Damaged Needs repair green red orange repair storage assigned employee asset serial CCIID search filters export template import validation status colors Dell case indicator overdue permission role'.toLowerCase();
    }
    const section = this.guideSections.find(item => item.title === title);
    const example = this.guideExamples[title];
    return [title, section?.access, section?.description, section?.steps, ...(this.guideStepLists[title] || []),
      example?.caption, ...(example?.fields.flatMap(field => [field.label, field.value]) || [])]
      .filter(Boolean).join(' ').toLowerCase();
  }

  onGuideSearch(value: string) {
    this.guideSearch.set(value);
    if (!value.trim()) return;
    const firstMatch = this.guideNavigationItems()[0];
    if (firstMatch && !this.guideNavigationItems().some(item => item.title === this.selectedGuideTab)) {
      this.selectedGuideTab = firstMatch.title;
    }
  }
  get activeGuideSection() { return this.guideSections.find(item => item.title === this.selectedGuideTab); }
  readonly pageGuideSteps: Record<string, string[]> = {
    '/dashboard': ['Search by asset name, serial, or employee to locate equipment.', 'Select an asset to review details and history.', 'Use Check out to assign available equipment or Check in to record its return.'],
    '/entry': ['Select Add Asset and enter its category, model, serial number, and current status.', 'Complete the assignment and warranty details when available.', 'Save the asset. Use the provided template for bulk imports and review any skipped-row errors.'],
    '/desk-setup': ['Find or select the employee or desk where equipment is installed.', 'Add the monitor and docking-station details; enter serials carefully.', 'Save the setup and review the displayed equipment list for duplicates or missing details.'],
    '/consumables': ['Add each supply with its name, category, unit, quantity, and storage location.', 'Set a reorder threshold so low stock is easy to spot.', 'Use Adjust stock whenever supplies are received or issued; check the quantity and reason before saving.'],
    '/employees': ['Search for an employee or open their profile.', 'Review assigned assets and check-in/check-out history.', 'Use an asset action to record a handover; confirm the employee and assignment details before saving.'],
    '/manage-employees': ['Search the employee directory before creating a record to avoid duplicates.', 'Add a person with the correct display name and CCIID, or edit their existing details.', 'Use this directory as the source for asset assignments and offboarding.'],
    '/returns': ['Search for the departing employee and check the displayed CCIID and outstanding assets.', 'Start the offboarding checklist, then review each asset and accessories received.', 'Choose Good, Damaged, or Needs repair and mark the item returned. Good assets move to In Storage; Damaged or Needs repair assets move Under Repair.', 'When every asset is recorded, offboarding completes and a former-employee snapshot is created.'],
    '/former-employees': ['Search by employee name or CCIID to find the archived record.', 'Use the eye icon to inspect assets captured at departure.', 'Review each saved return condition and asset details in the snapshot.'],
    '/dell-cases': ['Register a case with the Dell case ID, affected asset serial, registration date, issue, and status.', 'Check the case ID and serial number before saving to avoid linking the wrong equipment.', 'Open comments on a case to record updates; use the status field when the case changes.'],
    '/warranty': ['Search or filter the list to find an asset or a date range.', 'Review the purchase date and warranty end date.', 'Use the forecast to prioritize renewals or replacements; verify dates against the asset record before acting.'],
    '/links': ['Use a saved link to open a shared resource.', 'If a link is missing or outdated, ask an administrator to update the shared list.'],
    '/logs': ['Choose filters such as date, user, or action to narrow the history.', 'Review the event details to identify the affected record and who made the change.', 'Export the filtered results when you need a report.'],
    '/users': ['Create a user with their company email and the role that matches their duties.', 'Set their title in User Roles; profile users cannot edit their title themselves.', 'Review access before saving: viewers are read-only, data-entry users can update operations, and admins can manage users and restricted settings.']
  };
  get pageGuide(): { title: string; description: string; steps: string[] } | null {
    const route = this.router.url.split('?')[0];
    const key = route.startsWith('/employees/') ? '/employees' : route;
    const steps = this.pageGuideSteps[key];
    if (!steps) return null;
    const guide = this.guideSections.find(item => item.title === (key === '/dashboard' ? 'Dashboard' : key === '/entry' ? 'Asset Entry' : key === '/desk-setup' ? 'Desk Setup' : key === '/consumables' ? 'Consumables' : key === '/employees' ? 'Employees' : key === '/manage-employees' ? 'Manage Employees' : key === '/returns' ? 'Offboarding Returns' : key === '/former-employees' ? 'Former Employees' : key === '/dell-cases' ? 'Dell Cases' : key === '/warranty' ? 'Warranty & Forecast' : key === '/links' ? 'Links' : key === '/logs' ? 'Activity Trail' : 'User Roles'));
    return { title: guide?.title || this.pageTitle, description: guide?.description || '', steps };
  }
  private readonly defaultSidebarOrder = ['dashboard', 'assets', 'links', 'employees', 'manage-employees', 'former-employees', 'dell-cases', 'returns', 'warranty', 'logs', 'users'];
  private readonly defaultAssetChildOrder = ['entry', 'desk-setup', 'consumables', 'dropdowns'];
  readonly sidebarItems: SidebarItem[] = [
    { id: 'dashboard', label: 'Dashboard', route: '/dashboard', icon: 'fa-chart-pie', iconColor: '' },
    { id: 'assets', label: 'Assets', route: '/dashboard', icon: 'fa-boxes-stacked', iconColor: 'text-indigo-400', writeOnly: true },
    { id: 'links', label: 'Links', route: '/links', icon: 'fa-link', iconColor: 'text-indigo-400' },
    { id: 'employees', label: 'Employees', route: '/employees', icon: 'fa-users', iconColor: 'text-blue-400' },
    { id: 'manage-employees', label: 'Manage Employees', route: '/manage-employees', icon: 'fa-user-gear', iconColor: 'text-cyan-400', adminOnly: true },
    { id: 'former-employees', label: 'Former Employees', route: '/former-employees', icon: 'fa-box-archive', iconColor: 'text-slate-400' },
    { id: 'dell-cases', label: 'Dell Cases', route: '/dell-cases', icon: 'fa-screwdriver-wrench', iconColor: 'text-blue-400', writeOnly: true },
    { id: 'returns', label: 'Offboarding Returns', route: '/returns', icon: 'fa-clipboard-check', iconColor: 'text-emerald-400', writeOnly: true },
    { id: 'warranty', label: 'Warranty & Forecast', route: '/warranty', icon: 'fa-shield-halved', iconColor: 'text-amber-400' },
    { id: 'logs', label: 'Activity Trail', route: '/logs', icon: 'fa-clock-rotate-left', iconColor: 'text-purple-400' },
    { id: 'users', label: 'User Roles', route: '/users', icon: 'fa-user-shield', iconColor: 'text-pink-400', adminOnly: true }
  ];
  readonly assetChildItems: SidebarItem[] = [
    { id: 'entry', label: 'Asset Entry', route: '/entry', icon: 'fa-circle-plus', iconColor: 'text-indigo-400', writeOnly: true },
    { id: 'desk-setup', label: 'Desk Setup', route: '/desk-setup', icon: 'fa-desktop', iconColor: 'text-cyan-400', writeOnly: true },
    { id: 'consumables', label: 'Consumables', route: '/consumables', icon: 'fa-boxes-stacked', iconColor: 'text-emerald-400', adminOnly: true },
    { id: 'dropdowns', label: 'Dropdown Data', route: '/dropdowns', icon: 'fa-list-check', iconColor: 'text-violet-400' }
  ];
  sidebarEditMode = false;
  private sidebarOrder = [...this.defaultSidebarOrder];
  private assetChildOrder = [...this.defaultAssetChildOrder];
  private draggedNav: { id: string; lane: 'main' | 'assets' } | null = null;
  @ViewChild('commandInput') commandInput?: ElementRef<HTMLInputElement>;
  commandOpen = false;
  commandQuery = signal('');
  commandIndex = signal(0);
  commandResults = computed<CommandOption[]>(() => {
    const q = this.commandQuery().trim().toLowerCase();
    const assets = this.auth.canAny('assets.view', 'dashboard.view') ? this.data.assets() : [];
    const pages = [
      { label: 'Dashboard', detail: 'Fleet overview', icon: 'fa-chart-pie', route: '/dashboard', admin: false },
      { label: 'Asset entry', detail: 'Add or import equipment', icon: 'fa-circle-plus', route: '/entry', admin: false, write: true },
      { label: 'Dropdown data', detail: 'View and manage asset and consumable options', icon: 'fa-list-check', route: '/dropdowns', admin: false },
      { label: 'Desk setup', detail: 'Manage monitors and docking stations by desk', icon: 'fa-desktop', route: '/desk-setup', admin: false, write: true },
      { label: 'Shared links', detail: 'Open shared company websites and resources', icon: 'fa-link', route: '/links', admin: false },
      { label: 'Employees', detail: 'Assignments and people', icon: 'fa-users', route: '/employees', admin: false },
      { label: 'Manage employees', detail: 'Add, rename, and remove people', icon: 'fa-user-gear', route: '/manage-employees', admin: true },
      { label: 'Former employees', detail: 'Review offboarding asset snapshots', icon: 'fa-box-archive', route: '/former-employees', admin: false },
      { label: 'Dell cases', detail: 'Register and track Dell support cases', icon: 'fa-screwdriver-wrench', route: '/dell-cases', admin: false, write: true },
      { label: 'Offboarding returns', detail: 'Track equipment returns', icon: 'fa-clipboard-check', route: '/returns', admin: false },
      { label: 'Warranty', detail: 'Warranty status and alerts', icon: 'fa-shield-halved', route: '/warranty', admin: false },
      { label: 'Consumables', detail: 'Stock and reorder levels', icon: 'fa-boxes-stacked', route: '/consumables', admin: true },
      { label: 'User roles', detail: 'Manage user access', icon: 'fa-user-shield', route: '/users', admin: true },
      { label: 'Activity logs', detail: 'Review recent changes', icon: 'fa-clock-rotate-left', route: '/logs', admin: false }
    ].filter(p => this.canOpenCommandPage(p.route) && (!('write' in p) || this.canWriteCommandPage(p.route)));
    const result: CommandOption[] = [];
    const addPage = (label: string, detail: string, icon: string, route: string) => result.push({ kind: 'page', label, detail, icon, route });
    if (!q) {
      pages.slice(0, 5).forEach(p => addPage(p.label, p.detail, p.icon, p.route));
      addPage('Warranty alerts', 'See equipment nearing warranty end', 'fa-bell', '/warranty');
      assets.slice(0, 4).forEach(a => result.push({ kind: 'asset', label: a.name, detail: `${a.serial} · ${a.assignedTo || 'Stock'}`, icon: 'fa-laptop', assetId: a.id }));
      return result;
    }
    const intentIn = /\b(check\s*in|return|into storage)\b/.test(q);
    const intentOut = /\b(check\s*out|assign|give to)\b/.test(q);
    const term = q.replace(/\b(check\s*in|check\s*out|return|into storage|assign|give to|asset|serial)\b/g, '').trim();
    pages.filter(p => `${p.label} ${p.detail}`.toLowerCase().includes(q)).forEach(p => addPage(p.label, p.detail, p.icon, p.route));
    if (/warrant|expir|coverage/.test(q) && !result.some(r => r.route === '/warranty')) addPage('Warranty alerts', 'See equipment nearing warranty end', 'fa-bell', '/warranty');
    const matches = assets.filter(a => `${a.name} ${a.serial} ${a.assignedTo} ${a.category} ${a.department}`.toLowerCase().includes(term || q)).slice(0, 7);
    for (const a of matches) {
      result.push({ kind: 'asset', label: a.name, detail: `${a.serial} · ${a.assignedTo || 'Stock'}`, icon: 'fa-laptop', assetId: a.id });
      if (this.auth.can('assets.assign') && intentIn && a.assignedTo && a.assignedTo !== 'Stock') result.push({ kind: 'checkin', label: `Check in ${a.serial}`, detail: `Return ${a.name} to storage`, icon: 'fa-arrow-right-to-bracket', assetId: a.id });
      if (this.auth.can('assets.assign') && intentOut && (!a.assignedTo || a.assignedTo === 'Stock')) result.push({ kind: 'checkout', label: `Check out ${a.serial}`, detail: `Assign ${a.name} to an employee`, icon: 'fa-arrow-right-from-bracket', assetId: a.id });
    }
    const employees = [...new Set(assets.map(a => a.assignedTo).filter(n => n && n !== 'Stock'))];
    employees.filter(n => n.toLowerCase().includes(q)).slice(0, 4).forEach(n => result.push({ kind: 'employee', label: n, detail: 'Employee assignments', icon: 'fa-user', employee: n }));
    return result.slice(0, 12);
  });
  private canOpenCommandPage(route: string): boolean {
    if (route === '/dashboard') return this.auth.can('dashboard.view');
    if (route === '/entry') return this.auth.can('assets.view');
    if (route === '/dropdowns') return this.auth.can('dropdowns.view');
    if (route === '/desk-setup') return this.auth.can('deskSetup.view');
    if (route === '/links') return this.auth.can('links.view');
    if (route === '/employees') return this.auth.canAny('employees.view', 'employeeDirectory.view');
    if (route === '/manage-employees') return this.auth.can('employeeDirectory.view');
    if (route === '/former-employees') return this.auth.can('formerEmployees.view');
    if (route === '/dell-cases') return this.auth.can('dellCases.view');
    if (route === '/returns') return this.auth.can('offboarding.view');
    if (route === '/warranty') return this.auth.can('warranty.view');
    if (route === '/consumables') return this.auth.can('consumables.view');
    if (route === '/users') return this.auth.can('users.manage');
    if (route === '/logs') return this.auth.can('activity.view');
    return false;
  }
  private canWriteCommandPage(route: string): boolean {
    if (route === '/entry') return this.auth.canAny('assets.add', 'assets.edit', 'assets.assign', 'assets.delete');
    if (route === '/desk-setup') return this.auth.canAny('deskSetup.add', 'deskSetup.edit', 'deskSetup.delete', 'deskSetup.import');
    if (route === '/dell-cases') return this.auth.canAny('dellCases.add', 'dellCases.edit', 'dellCases.delete', 'dellCases.import');
    if (route === '/manage-employees') return this.auth.canAny('employeeDirectory.add', 'employeeDirectory.edit', 'employeeDirectory.delete', 'employeeDirectory.import');
    return true;
  }
  // login form
  loginEmail = '';
  loginPass = '';
  loginError = false;
  loginErrorMsg = '';
  loggingIn = false;
  showPass = false;

  // forgot password
  forgotOpen = false;

  sidebarOpen = false;
  sidebarCollapsed = false;
  sidebarTooltip = signal<{ label: string; top: number; left: number } | null>(null);
  assetsMenuOpen = true;
  profileOpen = false;
  profileMenuOpen = false;
  notificationsOpen = false;
  presenceOpen = false;
  notificationReadIds = signal<Set<string>>(new Set());
  notificationDismissedIds = signal<Set<string>>(new Set());
  /** Every notable asset-history event, newest first (before dismissals are applied). */
  private allActivity = computed(() => this.data.assets()
    .flatMap(asset => (asset.history ?? []).map(event => ({ ...event, asset })))
    .filter(event => /assign|check(?:ed)?\s*(?:in|out)|return|updated|edit/i.test(event.action))
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()));
  /** What the panel shows: notable activity minus anything the user has dismissed. */
  recentActivity = computed(() => this.allActivity().filter(event => !this.isNotificationDismissed(event)));
  unreadNotificationCount = computed(() => this.recentActivity().filter(event => !this.isNotificationRead(event)).length);
  /** Notifications bucketed by day (Today / Yesterday / date) for section headers. */
  notificationGroups = computed(() => {
    const groups: { label: string; events: ActivityEvent[] }[] = [];
    const byKey = new Map<string, { label: string; events: ActivityEvent[] }>();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayMs = 86_400_000;
    for (const event of this.recentActivity()) {
      const d = new Date(event.ts);
      let key: string, label: string;
      if (Number.isNaN(d.getTime())) {
        key = 'unknown'; label = 'Earlier';
      } else {
        const diffDays = Math.round((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / dayMs);
        if (diffDays <= 0) { key = 'today'; label = 'Today'; }
        else if (diffDays === 1) { key = 'yesterday'; label = 'Yesterday'; }
        else { key = d.toDateString(); label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
      }
      let group = byKey.get(key);
      if (!group) { group = { label, events: [] }; byKey.set(key, group); groups.push(group); }
      group.events.push(event);
    }
    return groups;
  });
  changePasswordEnabled = false;
  savingProfile = false;
  profileDisplayName = '';
  profileEmail = '';
  profileImage = '';
  photoCropOpen = false;
  photoCropSource = '';
  photoCropZoom = 1;
  photoCropX = 0;
  photoCropY = 0;
  photoCropWidth = 240;
  photoCropHeight = 240;
  private photoCropElement: HTMLImageElement | null = null;
  private photoCropObjectUrl = '';
  private photoCropDrag: { pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null = null;
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  profileError = '';

  constructor(
    public auth: AuthService,
    public theme: ThemeService,
    public data: DataService,
    public ui: UiService,
    public presence: PresenceService,
    private api: ApiService,
    private router: Router
  ) {
    this.loadNotificationReadState(); this.loadNotificationDismissState(); this.loadSidebarOrder(); this.loadSidebarCollapsed();
    effect(() => {
      if (this.auth.isLoggedIn()) {
        this.presence.start();
        this.data.startLiveSync(() => this.router.url, () => { void this.auth.refreshCurrentUser(); });
      } else {
        this.presence.stop();
        this.data.stopLiveSync();
      }
    });
  }

  visibleSidebarItems(): SidebarItem[] {
    const permissionByItem: Record<string, string> = { dashboard: 'dashboard.view', links: 'links.view', employees: 'employees.view', 'manage-employees': 'employeeDirectory.view', 'former-employees': 'formerEmployees.view', 'dell-cases': 'dellCases.view', returns: 'offboarding.view', warranty: 'warranty.view', logs: 'activity.view', users: 'users.manage' };
    return this.sidebarItems.filter(item => item.id === 'assets'
      ? this.auth.can('assets.view') || this.auth.can('deskSetup.view') || this.auth.can('consumables.view') || this.auth.can('dropdowns.view')
      : this.auth.can(permissionByItem[item.id] || 'dashboard.view'));
  }
  visibleAssetChildren(): SidebarItem[] {
    const permissionByItem: Record<string, string> = { entry: 'assets.view', 'desk-setup': 'deskSetup.view', consumables: 'consumables.view', dropdowns: 'dropdowns.view' };
    return this.assetChildItems.filter(item => this.auth.can(permissionByItem[item.id]));
  }
  orderedSidebarItems(): SidebarItem[] {
    const rank = new Map(this.sidebarOrder.map((id, index) => [id, index]));
    return [...this.visibleSidebarItems()].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  }
  orderedAssetChildren(): SidebarItem[] {
    const rank = new Map(this.assetChildOrder.map((id, index) => [id, index]));
    return [...this.visibleAssetChildren()].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  }
  private sidebarPreferenceKey() { return `assetflow_sidebar_order_${this.auth.currentUser()?.username || 'guest'}`; }
  private sidebarCollapsedPreferenceKey() { return `assetflow_sidebar_collapsed_${this.auth.currentUser()?.username || 'guest'}`; }
  private loadSidebarCollapsed() {
    try { this.sidebarCollapsed = localStorage.getItem(this.sidebarCollapsedPreferenceKey()) === 'true'; }
    catch { this.sidebarCollapsed = false; }
  }
  toggleSidebarCollapsed() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.sidebarTooltip.set(null);
    try { localStorage.setItem(this.sidebarCollapsedPreferenceKey(), String(this.sidebarCollapsed)); }
    catch { this.ui.error('Could not save your sidebar preference in this browser.'); }
  }
  showSidebarTooltip(event: MouseEvent | FocusEvent, label: string) {
    if (!this.sidebarCollapsed || !window.matchMedia('(min-width: 768px)').matches) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.sidebarTooltip.set({ label, top: rect.top + rect.height / 2, left: rect.right + 10 });
  }
  hideSidebarTooltip() { this.sidebarTooltip.set(null); }
  private loadSidebarOrder() {
    this.sidebarOrder = [...this.defaultSidebarOrder];
    this.assetChildOrder = [...this.defaultAssetChildOrder];
    try {
      const saved = JSON.parse(localStorage.getItem(this.sidebarPreferenceKey()) || '{}');
      if (Array.isArray(saved.main)) this.sidebarOrder = [...new Set([...saved.main.filter((id: unknown) => this.defaultSidebarOrder.includes(String(id))), ...this.defaultSidebarOrder])];
      if (Array.isArray(saved.assets)) this.assetChildOrder = [...new Set([...saved.assets.filter((id: unknown) => this.defaultAssetChildOrder.includes(String(id))), ...this.defaultAssetChildOrder])];
    } catch { /* Keep the default navigation order if browser storage is unavailable. */ }
  }
  toggleSidebarEdit() {
    if (this.sidebarEditMode) {
      try { localStorage.setItem(this.sidebarPreferenceKey(), JSON.stringify({ main: this.sidebarOrder, assets: this.assetChildOrder })); }
      catch { this.ui.error('Could not save your sidebar order in this browser.'); }
      this.sidebarEditMode = false;
      this.draggedNav = null;
      return;
    }
    this.sidebarOpen = true;
    this.assetsMenuOpen = true;
    this.sidebarEditMode = true;
  }
  allowNavDrop(event: DragEvent) { if (this.sidebarEditMode) event.preventDefault(); }
  startNavDrag(event: DragEvent, id: string, lane: 'main' | 'assets') {
    if (!this.sidebarEditMode) { event.preventDefault(); return; }
    event.stopPropagation();
    this.draggedNav = { id, lane };
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
  dropNavItem(event: DragEvent, targetId: string, lane: 'main' | 'assets') {
    event.preventDefault();
    if (!this.sidebarEditMode || !this.draggedNav || this.draggedNav.lane !== lane) return;
    this.reorderNav(this.draggedNav.id, targetId, lane);
    this.draggedNav = null;
  }
  dropNavAtEnd(event: DragEvent, lane: 'main' | 'assets') {
    event.preventDefault();
    if (!this.sidebarEditMode || !this.draggedNav || this.draggedNav.lane !== lane) return;
    const orderedIds = (lane === 'main' ? this.orderedSidebarItems() : this.orderedAssetChildren()).map(item => item.id);
    const from = orderedIds.indexOf(this.draggedNav.id);
    if (from >= 0) {
      orderedIds.splice(from, 1);
      orderedIds.push(this.draggedNav.id);
      if (lane === 'main') this.sidebarOrder = [...orderedIds, ...this.sidebarOrder.filter(id => !orderedIds.includes(id))];
      else this.assetChildOrder = [...orderedIds, ...this.assetChildOrder.filter(id => !orderedIds.includes(id))];
    }
    this.draggedNav = null;
  }
  endNavDrag() { this.draggedNav = null; }
  private reorderNav(id: string, targetId: string, lane: 'main' | 'assets') {
    if (id === targetId) return;
    const visible = (lane === 'main' ? this.orderedSidebarItems() : this.orderedAssetChildren()).map(item => item.id);
    const from = visible.indexOf(id); const to = visible.indexOf(targetId);
    if (from < 0 || to < 0) return;
    visible.splice(from, 1); visible.splice(to, 0, id);
    if (lane === 'main') this.sidebarOrder = [...visible, ...this.sidebarOrder.filter(value => !visible.includes(value))];
    else this.assetChildOrder = [...visible, ...this.assetChildOrder.filter(value => !visible.includes(value))];
  }

  get pageTitle(): string {
    const url = this.router.url.split('?')[0];
    const titles: Record<string, string> = {
      '/dashboard': 'Hardware Fleet Overview',
      '/entry': 'Dedicated Asset Entry Portal',
      '/dropdowns': 'Manage Dropdown Data',
      '/employees': 'Employee Equipment Assignments',
      '/manage-employees': 'Manage Employee Roster',
      '/returns': 'Employee Equipment Offboarding',
      '/warranty': 'Warranty & Predictive Forecasting',
      '/consumables': 'Consumables Inventory',
      '/desk-setup': 'Desk Monitor & Dock Setup',
      '/links': 'Shared Links',
      '/former-employees': 'Former Employees',
      '/dell-cases': 'Dell Case Register',
      '/users': 'System User Roles',
      '/logs': 'Audit Activity Trail'
    };
    return titles[url] || 'Hardware Fleet Overview';
  }

  get roleLabel(): string { return this.auth.currentUser()?.role ?? ''; }
  get username(): string { return this.auth.currentUser()?.username ?? 'User'; }
  get displayName(): string { return this.auth.currentUser()?.displayName || this.username; }
  get profilePhoto(): string { return this.auth.currentUser()?.profileImage || ''; }
  get avatar(): string {
    const initials = this.displayName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]);
    return (initials.join('') || 'U').toUpperCase();
  }

  get accountTitleLabel(): string {
    const user = this.auth.currentUser();
    if (!user) return '';
    const title = this.data.users().find(row => row.username === user.username)?.title || user.title;
    return title?.trim() || 'Title not set';
  }

  get email(): string { return this.auth.currentUser()?.email ?? ''; }

  async handleLogin() {
    if (this.loggingIn) return;
    const email = (this.loginEmail || '').trim();
    // Cheap client-side guard so we don't fire an obviously-invalid request.
    if (!email || !this.loginPass) {
      this.loginError = true;
      this.loginErrorMsg = 'Enter your company email and password.';
      return;
    }
    this.loggingIn = true;
    this.loginError = false;
    const res = await this.auth.login(email, this.loginPass);
    this.loggingIn = false;
    if (!res.ok) { this.loginError = true; this.loginErrorMsg = res.error || 'Invalid company email or password.'; return; }
    this.loginError = false;
    this.loginPass = '';
    this.loadNotificationReadState();
    this.loadNotificationDismissState();
    this.loadSidebarOrder();
    this.loadSidebarCollapsed();
    this.router.navigate(['/dashboard']);
  }

  handleLogout() {
    // Subscribe before clearing the token so the auth interceptor can attach it.
    // Keep logout immediate; a network outage should never trap the user in-app.
    void firstValueFrom(this.api.post<{ ok: boolean }>('/auth/logout', {})).catch(() => {});
    this.presence.stop();
    this.auth.logout();
    this.router.navigate(['/']);
  }

  togglePass() { this.showPass = !this.showPass; }
  toggleTheme() { this.theme.toggle(); }
  toggleSidebar() { this.sidebarOpen = !this.sidebarOpen; }
  toggleAssetsMenu() { this.assetsMenuOpen = !this.assetsMenuOpen; }
  isAssetsRouteActive() { return ['/entry', '/desk-setup', '/consumables', '/dropdowns'].some(path => this.router.url.split('?')[0].startsWith(path)); }

  openCommandBar() {
    if (!this.auth.isLoggedIn()) return;
    this.commandOpen = true;
    this.commandQuery.set('');
    this.commandIndex.set(0);
    setTimeout(() => this.commandInput?.nativeElement.focus());
  }
  closeCommandBar() { this.commandOpen = false; this.commandQuery.set(''); }
  onCommandQueryChange() { this.commandIndex.set(0); }
  onCommandKeydown(event: KeyboardEvent) {
    const count = this.commandResults().length;
    if (event.key === 'ArrowDown') { event.preventDefault(); this.commandIndex.set(count ? (this.commandIndex() + 1) % count : 0); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); this.commandIndex.set(count ? (this.commandIndex() + count - 1) % count : 0); }
    else if (event.key === 'Enter') { event.preventDefault(); this.selectCommand(this.commandResults()[this.commandIndex()]); }
    else if (event.key === 'Escape') { event.preventDefault(); this.closeCommandBar(); }
  }
  selectCommand(option?: CommandOption) {
    if (!option) return;
    this.closeCommandBar();
    if (option.assetId != null) {
      const action = option.kind === 'checkin' ? 'checkin' : option.kind === 'checkout' ? 'checkout' : null;
      this.router.navigate(['/dashboard'], { queryParams: { asset: option.assetId, ...(action ? { action } : {}) } });
    } else if (option.kind === 'employee' && option.employee) this.router.navigate(['/employees', option.employee]);
    else if (option.route) this.router.navigateByUrl(option.route);
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalShortcut(event: KeyboardEvent) {
    // Command palette: Ctrl/Cmd+K works everywhere, even while typing.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.commandOpen ? this.closeCommandBar() : this.openCommandBar();
      return;
    }
    // Escape closes the top-most overlay.
    if (event.key === 'Escape') {
      if (this.shortcutsOpen()) { this.shortcutsOpen.set(false); return; }
      if (this.commandOpen) { this.closeCommandBar(); return; }
    }
    // Everything below is single-key; ignore modifier combos, typing, and open palettes.
    if (event.ctrlKey || event.metaKey || event.altKey) { this.clearNavLeader(); return; }
    if (this.commandOpen || this.isTypingTarget(event.target)) { this.clearNavLeader(); return; }
    // Resolve a pending "G then <key>" navigation chord.
    if (this.navLeaderActive) {
      const route = this.navShortcutRoutes[event.key.toLowerCase()];
      this.clearNavLeader();
      if (route) { event.preventDefault(); this.closeProfileMenu(); this.router.navigateByUrl(route); }
      return;
    }
    const key = event.key.toLowerCase();
    if (event.key === '?') { event.preventDefault(); this.openShortcuts(); }
    else if (key === 'h') { event.preventDefault(); this.openGuide(); }
    else if (key === 'g') {
      event.preventDefault();
      this.navLeaderActive = true;
      if (this.navLeaderTimer) clearTimeout(this.navLeaderTimer);
      this.navLeaderTimer = setTimeout(() => { this.navLeaderActive = false; }, 1500);
    }
    else if (key === 't') { event.preventDefault(); this.toggleTheme(); }
  }

  // ---- Keyboard shortcuts help + global navigation chords ----
  shortcutsOpen = signal(false);
  openShortcuts() { this.closeProfileMenu(); this.shortcutsOpen.set(true); }
  closeShortcuts() { this.shortcutsOpen.set(false); }
  readonly shortcutGroups: { title: string; items: { keys: string[]; label: string }[] }[] = [
    { title: 'General', items: [
      { keys: ['Ctrl', 'K'], label: 'Open command palette' },
      { keys: ['?'], label: 'Show keyboard shortcuts' },
      { keys: ['H'], label: 'Open website guide' },
      { keys: ['T'], label: 'Toggle light / dark theme' },
      { keys: ['Esc'], label: 'Close dialogs and menus' },
    ]},
    { title: 'Go to (press G, then…)', items: [
      { keys: ['G', 'D'], label: 'Dashboard' },
      { keys: ['G', 'E'], label: 'Employees' },
      { keys: ['G', 'N'], label: 'New asset entry' },
      { keys: ['G', 'R'], label: 'Returns' },
      { keys: ['G', 'W'], label: 'Warranty' },
      { keys: ['G', 'C'], label: 'Consumables' },
      { keys: ['G', 'U'], label: 'Users' },
      { keys: ['G', 'L'], label: 'Activity logs' },
      { keys: ['G', 'S'], label: 'Desk setup' },
      { keys: ['G', 'K'], label: 'Dell cases' },
      { keys: ['G', 'M'], label: 'Manage employees' },
      { keys: ['G', 'F'], label: 'Former employees' },
      { keys: ['G', 'B'], label: 'Shared links' },
    ]},
  ];
  private navLeaderActive = false;
  private navLeaderTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly navShortcutRoutes: Record<string, string> = {
    d: '/dashboard', e: '/employees', n: '/entry', r: '/returns',
    w: '/warranty', c: '/consumables', u: '/users', l: '/logs', s: '/desk-setup', k: '/dell-cases',
    m: '/manage-employees', f: '/former-employees', b: '/links',
  };
  private clearNavLeader() { this.navLeaderActive = false; if (this.navLeaderTimer) { clearTimeout(this.navLeaderTimer); this.navLeaderTimer = null; } }
  private isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || typeof el.tagName !== 'string') return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
  }

  toggleProfileMenu() { this.profileMenuOpen = !this.profileMenuOpen; }
  closeProfileMenu() { this.profileMenuOpen = false; }
  openGuide() { this.closeProfileMenu(); if (this.pageGuide) this.selectedGuideTab = this.pageGuide.title; this.guideSearch.set(''); this.guideMobileNavOpen = false; this.guideOpen = true; }
  selectGuideTab(title: string) { this.selectedGuideTab = title; this.guideMobileNavOpen = false; }
  closeGuide() { this.guideOpen = false; }

  toggleNotifications() { this.notificationsOpen = !this.notificationsOpen; }
  closeNotifications() { this.notificationsOpen = false; }
  togglePresence() {
    this.presenceOpen = !this.presenceOpen;
    if (this.presenceOpen) { this.presence.refreshNow(); this.closeNotifications(); this.closeProfileMenu(); }
  }
  closePresence() { this.presenceOpen = false; }
  presenceLastUpdated(value: string): string {
    const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
    if (!Number.isFinite(elapsed)) return 'Last updated time unavailable';
    if (elapsed < 60_000) return `Updated ${Math.max(1, Math.floor(elapsed / 1000))} sec ago`;
    if (elapsed < 3_600_000) return `Updated ${Math.floor(elapsed / 60_000)} min ago`;
    return `Updated ${new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  notificationId(event: { asset: { id: number; serial: string }; ts: string; user: string; action: string }): string {
    return `${event.asset.id}|${event.asset.serial}|${event.ts}|${event.user}|${event.action}`;
  }
  isNotificationRead(event: { asset: { id: number; serial: string }; ts: string; user: string; action: string }): boolean {
    return this.notificationReadIds().has(this.notificationId(event));
  }
  toggleNotificationRead(event: { asset: { id: number; serial: string }; ts: string; user: string; action: string }) {
    const id = this.notificationId(event);
    const next = new Set(this.notificationReadIds());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.saveNotificationReadState(next);
  }
  markAllNotificationsRead() {
    const next = new Set(this.notificationReadIds());
    this.recentActivity().forEach(event => next.add(this.notificationId(event)));
    this.saveNotificationReadState(next);
  }
  isNotificationDismissed(event: { asset: { id: number; serial: string }; ts: string; user: string; action: string }): boolean {
    return this.notificationDismissedIds().has(this.notificationId(event));
  }
  /** Remove a single notification from the panel (the per-item delete button). */
  dismissNotification(event: { asset: { id: number; serial: string }; ts: string; user: string; action: string }, mouseEvent?: Event) {
    mouseEvent?.stopPropagation();
    const next = new Set(this.notificationDismissedIds());
    next.add(this.notificationId(event));
    this.saveNotificationDismissState(next);
  }
  /** Dismiss every notification currently in view ("Clear"). */
  clearAllNotifications() {
    const next = new Set(this.notificationDismissedIds());
    this.recentActivity().forEach(event => next.add(this.notificationId(event)));
    this.saveNotificationDismissState(next);
  }
  private notificationDismissStorageKey(): string {
    const user = this.auth.currentUser();
    return `assetflow-notification-dismissed:${user?.username || user?.email || 'guest'}`;
  }
  private loadNotificationDismissState() {
    try {
      const saved = localStorage.getItem(this.notificationDismissStorageKey());
      const ids = saved ? JSON.parse(saved) : [];
      this.notificationDismissedIds.set(new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []));
    } catch { this.notificationDismissedIds.set(new Set()); }
  }
  private saveNotificationDismissState(ids: Set<string>) {
    this.notificationDismissedIds.set(ids);
    try { localStorage.setItem(this.notificationDismissStorageKey(), JSON.stringify([...ids])); } catch { /* Keep the in-memory preference for this session. */ }
  }
  private notificationStorageKey(): string {
    const user = this.auth.currentUser();
    return `assetflow-notification-read:${user?.username || user?.email || 'guest'}`;
  }
  private loadNotificationReadState() {
    try {
      const saved = localStorage.getItem(this.notificationStorageKey());
      const ids = saved ? JSON.parse(saved) : [];
      this.notificationReadIds.set(new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []));
    } catch { this.notificationReadIds.set(new Set()); }
  }
  private saveNotificationReadState(ids: Set<string>) {
    this.notificationReadIds.set(ids);
    try { localStorage.setItem(this.notificationStorageKey(), JSON.stringify([...ids])); } catch { /* Keep the in-memory preference for this session. */ }
  }
  notificationTime(ts: string): string {
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  /** Short "6h ago" style stamp like the one in the native app's notification tray. */
  notificationRelativeTime(ts: string): string {
    const time = new Date(ts).getTime();
    if (Number.isNaN(time)) return '';
    const diff = Date.now() - time;
    if (diff < 45_000) return 'just now';
    const mins = Math.round(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.round(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    return this.notificationTime(ts);
  }
  notificationIcon(action: string): string {
    if (/return|check(?:ed)?\s*in/i.test(action)) return 'fa-arrow-right-to-bracket';
    if (/assign|check(?:ed)?\s*out/i.test(action)) return 'fa-user-check';
    return 'fa-pen-to-square';
  }
  openNotificationAsset(event: { asset: { id: number; serial: string }; ts: string; user: string; action: string }) {
    const next = new Set(this.notificationReadIds());
    next.add(this.notificationId(event));
    this.saveNotificationReadState(next);
    this.closeNotifications();
    this.router.navigate(['/dashboard'], { queryParams: { asset: event.asset.id } });
  }

  @HostListener('document:click', ['$event'])
  closeProfileMenuOnOutsideClick(event: MouseEvent) {
    if (!(event.target as HTMLElement | null)?.closest('.profile-menu-root')) this.closeProfileMenu();
    if (!(event.target as HTMLElement | null)?.closest('.notification-menu-root')) this.closeNotifications();
    if (!(event.target as HTMLElement | null)?.closest('.presence-menu-root')) this.closePresence();
  }

  @HostListener('document:keydown.escape')
  closeProfileMenuOnEscape() { this.closeProfileMenu(); this.closeNotifications(); this.closePresence(); this.closeGuide(); }

  openProfile() {
    const user = this.auth.currentUser();
    if (!user) return;
    this.closeProfileMenu();
    this.profileDisplayName = user.displayName || user.username;
    this.profileEmail = user.email || '';
    this.profileImage = user.profileImage || '';
    this.clearPhotoCrop();
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';
    this.profileError = '';
    this.changePasswordEnabled = false;
    this.profileOpen = true;
  }

  toggleChangePassword() {
    this.changePasswordEnabled = !this.changePasswordEnabled;
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';
    this.profileError = '';
  }

  closeProfile() {
    if (this.savingProfile) return;
    this.profileOpen = false;
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';
    this.profileError = '';
    this.changePasswordEnabled = false;
    this.clearPhotoCrop();
  }

  onProfilePhotoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.profileError = 'Choose a JPEG, PNG, or WebP image.';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.profileError = 'Choose an image smaller than 8 MB.';
      return;
    }

    this.clearPhotoCrop();
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const cropSize = 240;
      const scale = Math.max(cropSize / image.naturalWidth, cropSize / image.naturalHeight);
      this.photoCropElement = image;
      this.photoCropObjectUrl = objectUrl;
      this.photoCropSource = objectUrl;
      this.photoCropWidth = image.naturalWidth * scale;
      this.photoCropHeight = image.naturalHeight * scale;
      this.photoCropZoom = 1;
      this.photoCropX = 0;
      this.photoCropY = 0;
      this.photoCropOpen = true;
      this.profileError = '';
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      this.profileError = 'Could not read this picture. Try another image.';
    };
    image.src = objectUrl;
  }

  private clearPhotoCrop() {
    if (this.photoCropObjectUrl) URL.revokeObjectURL(this.photoCropObjectUrl);
    this.photoCropObjectUrl = '';
    this.photoCropElement = null;
    this.photoCropSource = '';
    this.photoCropOpen = false;
    this.photoCropDrag = null;
  }

  updatePhotoCropZoom(value: number) {
    this.photoCropZoom = Number(value);
    this.constrainPhotoCrop();
  }

  beginPhotoCropDrag(event: PointerEvent) {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.photoCropDrag = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: this.photoCropX,
      offsetY: this.photoCropY
    };
  }

  movePhotoCropDrag(event: PointerEvent) {
    if (!this.photoCropDrag) return;
    this.photoCropX = this.photoCropDrag.offsetX + event.clientX - this.photoCropDrag.pointerX;
    this.photoCropY = this.photoCropDrag.offsetY + event.clientY - this.photoCropDrag.pointerY;
    this.constrainPhotoCrop();
  }

  endPhotoCropDrag(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    this.photoCropDrag = null;
  }

  private constrainPhotoCrop() {
    const maxX = Math.max(0, (this.photoCropWidth * this.photoCropZoom - 240) / 2);
    const maxY = Math.max(0, (this.photoCropHeight * this.photoCropZoom - 240) / 2);
    this.photoCropX = Math.min(maxX, Math.max(-maxX, this.photoCropX));
    this.photoCropY = Math.min(maxY, Math.max(-maxY, this.photoCropY));
  }

  applyPhotoCrop() {
    const image = this.photoCropElement;
    if (!image) return;
    const cropSize = 240;
    const outputSize = 256;
    const outputScale = outputSize / cropSize;
    const width = this.photoCropWidth * this.photoCropZoom;
    const height = this.photoCropHeight * this.photoCropZoom;
    const left = (cropSize - width) / 2 + this.photoCropX;
    const top = (cropSize - height) / 2 + this.photoCropY;
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext('2d');
    if (!context) {
      this.profileError = 'Could not process this picture. Try another image.';
      return;
    }
    context.drawImage(image, left * outputScale, top * outputScale, width * outputScale, height * outputScale);
    this.profileImage = canvas.toDataURL('image/jpeg', 0.82);
    this.clearPhotoCrop();
    this.profileError = '';
  }

  cancelPhotoCrop() { this.clearPhotoCrop(); }

  removeProfilePhoto() {
    this.clearPhotoCrop();
    this.profileImage = '';
  }

  async saveProfile() {
    this.profileError = '';
    if (this.photoCropOpen) { this.profileError = 'Apply or cancel the picture crop before saving your profile.'; return; }
    this.savingProfile = true;
    const result = await this.auth.updateProfile({ profileImage: this.profileImage });
    this.savingProfile = false;
    if (!result.ok) { this.profileError = result.error || 'Could not update your profile.'; return; }
    this.profileOpen = false;
    this.ui.success('Profile settings saved.');
  }

  /** Navigation keeps the selected desktop sidebar mode and closes the mobile drawer. */
  onNavClick() { this.sidebarOpen = false; }
  handleNavClick(event: Event) {
    if (this.sidebarEditMode) { event.preventDefault(); return; }
    this.onNavClick();
  }

  openForgot() { this.forgotOpen = true; }
  closeForgot() { this.forgotOpen = false; }

  // Header actions
  closeQr() { this.ui.closeQr(); }

  // QR rendering reaction
  private lastQrSerial = '';
  ngDoCheck() {
    if (this.ui.qrVisible() && this.ui.qrSerial() !== this.lastQrSerial) {
      this.lastQrSerial = this.ui.qrSerial();
      setTimeout(() => {
        const container = document.getElementById('qrcodeContainer');
        if (container) {
          container.innerHTML = '';
          new QRCode(container, { text: `ASSETFLOW://${this.ui.qrSerial()}`, width: 140, height: 140, colorDark: '#0f172a', colorLight: '#ffffff' });
        }
      });
    }
    if (!this.ui.qrVisible()) this.lastQrSerial = '';
  }
}
