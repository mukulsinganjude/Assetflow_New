# AssetFlow Website Workflow

This guide maps the main screens, what each screen is for, the usual tasks, and how access is organized. The left navigation can be reordered by each user, so names below refer to the screen labels rather than their visual position.

## 1. Website workflow tree

```text
Open AssetFlow
└── Sign in with company email and password
    ├── Login succeeds
    │   ├── Dashboard — overview and shortcuts
    │   ├── Assets
    │   │   ├── Asset Entry — add, edit, assign, import, export assets
    │   │   ├── Desk Setup — track equipment by desk
    │   │   └── Consumables — track quantities, thresholds, and adjustments
    │   ├── Employees — find people and view assigned equipment
    │   │   └── Employee details — equipment, history, and comments
    │   ├── Manage Employees [admin] — maintain the employee directory
    │   ├── Offboarding Returns — checklist and equipment return workflow
    │   ├── Former Employees — completed departures and saved records
    │   ├── Dell Cases — support cases associated with equipment
    │   ├── Warranty & Forecast — coverage dates and warranty updates
    │   ├── Links — shared work links
    │   ├── Activity Trail — searchable audit history
    │   ├── User Roles [admin] — accounts, roles, and user-specific access
    │   ├── Global header — online tracker, notifications, and profile
    │   └── Help button — tab guide, examples, field snapshots, and notes
    └── Login fails
        └── Show an error; check company email, password, and API availability
```

## 2. Screens and their workflows

| Screen | Purpose | Typical workflow |
|---|---|---|
| **Dashboard** | See an overview of the asset fleet and move quickly to common actions. | Review summary cards and asset list → search/filter → open a record or choose an allowed action → confirm the updated status or assignee. |
| **Asset Entry** | Create and maintain individually tracked equipment. | Add Asset → select category/model → enter a unique serial number and other available details → choose status/department/assignee → save → verify it appears in the asset list. For existing items, open the record to edit, assign, comment, export, or remove it when permitted. |
| **Desk Setup** | Record peripherals installed at desks. | Search or select a desk → add monitor/dock or another supported peripheral → enter model and serial details → save → review the desk record. Imports and exports are available according to access. |
| **Consumables** | Track quantity-based supplies such as cables and adapters. | Add an item with category, unit, quantity, reorder threshold, and location → save → adjust stock when supplies arrive or are used → review low-stock indicators. |
| **Employees** | Find employees and see equipment assigned to them. | Search for a person → open the employee detail → review assigned assets/history → use comments or permitted asset actions. This is the employee-facing directory view. |
| **Manage Employees** | Maintain the employee directory used by assignments and offboarding. | Add or import an employee → maintain name, department, and company identifier → edit or remove outdated directory records. This screen is admin-only in navigation. |
| **Offboarding Returns** | Track an employee departure and recover assigned equipment. | Find/select the employee → start a return checklist → inspect each outstanding asset → record condition/accessories/notes → mark each item returned → complete the checklist when all items are resolved. |
| **Former Employees** | Review saved records after an employee has completed offboarding. | Search the former employee list → inspect the saved record → use archive/export actions if available to your access. |
| **Dell Cases** | Track support or repair cases tied to assets and employees. | Add a case → associate the equipment/person → enter case ID, date, issue, and status → update progress and comments → close or remove the case when permitted. |
| **Warranty & Forecast** | Review coverage dates and warranty-related risk. | Filter the list by warranty period/status → inspect the relevant asset or case → update/import warranty information if authorized → export the view when needed. |
| **Links** | Keep useful internal resources available in one place. | Add a link with a clear name and purpose → open it when needed → remove outdated links if permitted. |
| **Activity Trail** | Review actions recorded by the application. | Search/filter the audit list → inspect who performed an action and when → export records if authorized. Clearing history is restricted. |
| **User Roles** | Manage application accounts and access. | Add/select a user → assign a role → optionally set that user’s individual permissions → save → verify the account/access. Administrators retain full access. |
| **Online tracker** | See active users connected to the same API service. | Open the people/online control in the header → review names and last update → use “Hide me” or “Show me online” for your own presence. |
| **Website guide** | Explain each tab with steps, examples, and useful notes. | Open the help button → select a section in the guide sidebar → review its purpose, instructions, and sample field snapshot → use guide search to find a tab or topic. |

## 3. Common end-to-end tasks

### Add and assign a new asset

1. Open **Asset Entry** or use the asset shortcut on **Dashboard**.
2. Choose **Add Asset** and fill in the category, model, and unique serial number.
3. Choose its status and department. If assigning now, select the employee and assignment type.
4. Add purchase or warranty dates and any other known details.
5. Save, then check the Dashboard or employee page to confirm the asset and assignment.

### Check an asset out or back in

1. Find the asset on **Dashboard**, **Asset Entry**, or the employee’s detail page.
2. Choose the check-out action to assign available stock, or check-in to record its return.
3. Confirm the employee/assignment and record handover condition or accessories when prompted.
4. Save and verify the updated owner and status in the asset record.

### Offboard an employee

1. Open **Offboarding Returns** and search for the employee.
2. Start a checklist and review the outstanding equipment.
3. Inspect each item and record condition, accessories, and notes.
4. Mark each return and complete offboarding after all assigned items are handled.
5. Review the resulting record in **Former Employees**.

### Add a user and control their access

1. An administrator opens **User Roles** and adds/selects the account.
2. Assign the closest default role (Admin, Entry, or Viewer).
3. If needed, set a user-specific permission list; a saved override replaces that user’s role defaults.
4. Save and have the user sign in again/refresh their profile before verifying their visible tabs and actions.

### Find or export records

1. Open the relevant screen and search by a name, serial, model, or identifier.
2. Apply category, status, date, or department filters where present.
3. Check the visible results and page controls.
4. Choose Export if your account has export permission.

## 4. Roles and access model

The application has three built-in role defaults. An administrator can also grant a user-specific permission override. A custom override replaces that user’s default role permission list. Admin accounts keep full access and cannot be restricted by an override.

| Area / action | Admin | Entry default | Viewer default |
|---|:---:|:---:|:---:|
| Dashboard view | ✓ | ✓ | ✓ |
| Assets: view, add, edit, assign, import, export, comment | ✓ | ✓ | View only |
| Assets: delete | ✓ | — | — |
| Employee view and comments | ✓ | ✓ | View only |
| Employee directory: add, edit, delete, import, export | ✓ | — | — |
| Offboarding: view, start, return | ✓ | ✓ | — |
| Former Employees: view, archive, export | ✓ | ✓ | View and export |
| Dell Cases: view, add, edit, delete, import, export, comment | ✓ | ✓ | — |
| Warranty: view, edit, import, export | ✓ | ✓ | View and export |
| Links: view, add, delete, import, export | ✓ | ✓ | View only |
| Desk Setup: view, add, edit, delete, import, export | ✓ | ✓ | — |
| Consumables: view, add, edit, delete, import, export, adjust | ✓ | — | — |
| Activity Trail: view and export | ✓ | ✓ | ✓ |
| Activity Trail: clear | ✓ | — | — |
| User management and permissions | ✓ | — | — |
| Backup and restore | ✓ | — | — |

**Legend:** ✓ means the built-in role includes the listed capability; “View only” means the role includes the view capability, not the write actions. A custom per-user override may change non-admin access. The API enforces permissions in addition to the interface hiding unavailable actions.

## 5. Shared controls and useful notes

- **Search and filters:** Use these to narrow large lists before paging or exporting.
- **Status meanings:** Asset status indicates whether equipment is **In Use**, **In Storage**, or **Under Repair**.
- **Return condition:** **Good** items can return to storage; **Damaged** or **Needs repair** items should be routed for repair.
- **Validation:** Serial numbers identify assets; check that they are correct and unique before saving or importing. Use company email addresses for accounts.
- **Presence:** The online list is shared only by users connected to the same running API service.
- **Permissions:** If a tab or action is missing, ask an administrator to review your role and any individual permission override.
- **Imports and exports:** Use the relevant module’s template when available, review the data before importing, and check the result/skipped-row messages afterward.
- **Mobile:** The navigation opens as a drawer. Close it after choosing a screen; tables and wide forms may need horizontal scrolling within their own panel.
- **Data safety:** Confirm employee, asset, and serial details before destructive actions. Use archive/restore tools where available to recover an accidentally removed record.

## 6. Help and support path

```text
Something looks wrong
├── Missing screen/action → ask an administrator to check role/user permissions
├── Data is missing or outdated → refresh; verify filters; check the right environment
├── Sign-in/API error → confirm the local API is running at http://localhost:3000/api/health
├── Incorrect asset/employee data → correct it in its owning module and verify the audit trail
└── Need more context → open the in-app Guide and search for the tab or task
```

---

This is a workflow reference, not a promise that every account sees every action. The current user’s role and individual access settings determine the screens and actions available to them.
