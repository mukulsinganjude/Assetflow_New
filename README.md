# AssetFlow

AssetFlow is an IT asset management application with an Angular 18 frontend and a Node/Express API. It tracks assets, assignments, employee returns, warranties, support cases, consumables, shared links, roles, and activity history.

## Requirements

- Node.js 18.19+ or 20.11+
- npm 9+

## Run locally

Install dependencies and start the API and frontend:

```powershell
npm install
cd server
npm install
cd ..
npm run dev
```

Open <http://localhost:4200>. The API listens on <http://localhost:3000>.

To use the same running instance from another device on your private network, keep both processes running on this computer and open `http://<this-computer-ip>:4200` on the other device (for example, `http://192.168.1.25:4200`). Find this computer's IPv4 address with `ipconfig` on Windows. Both devices must be on the same network, and Windows Firewall may prompt you to allow Node.js on a private network. Do not run a separate copy on the other device if you want shared data: each copy has its own `server/data.json`.

On first startup, create a private `.env.local` file in the project root with an administrator account:

```dotenv
ASSETFLOW_BOOTSTRAP_ADMIN_EMAIL=admin@ccrn.com
ASSETFLOW_BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-unique-password
ASSETFLOW_BOOTSTRAP_ADMIN_NAME=AssetFlow Administrator
```

Use a unique password of 12–72 characters. Bootstrap settings are only used to initialize an empty database. After first startup, the app stores its data in `server/data.json`; that file is ignored by Git. Keep it private and make regular backups. To move data to another computer, stop the API and copy `server/data.json` there.

## Build the frontend

```powershell
npm run build
```

## Security and storage

- The API uses a local JSON database at `server/data.json`; it does not require a hosted database or external service credentials.
- Passwords are stored as bcrypt hashes. Set a strong `JWT_SECRET` in the environment for deployments; local development generates and saves a private random secret in `server/.jwt-secret`.
- API routes require a valid JWT. Role and per-user permissions are checked server-side.
- The frontend stores the session token and current user in browser local storage. Theme and interface preferences are stored there as well.
- User-provided text is rendered through Angular interpolation, which escapes HTML.
- The API and frontend are configured for local development. The database is a single local file, so this setup is intended for use on one machine rather than concurrent multi-server hosting.

## Project structure

```text
server/                 Node/Express API and local JSON persistence
  server.js             API routes, authentication, and error handling
  db.js                 Local state, normalization, and durable writes
  auth.js               JWT signing and authentication middleware
  validation.js         Input validation and sanitization
src/                    Angular frontend
  app/components/       Asset, employee, warranty, inventory, and admin screens
  app/services/         Authentication, API, data, UI, and theme services
```
"# Assetflow_New" 
