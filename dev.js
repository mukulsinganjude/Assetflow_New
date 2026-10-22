/**
 * dev.js — starts the API server and the Angular dev server together.
 *
 * Usage:  npm run dev
 *
 * Zero external dependencies: uses Node's built-in child_process.
 * Press Ctrl+C once to stop both processes.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const serverDir = path.join(root, 'server');

// Friendly pre-flight checks so failures are obvious.
if (!fs.existsSync(path.join(serverDir, 'node_modules'))) {
  console.error('\n[dev] Backend dependencies missing. Run this once:\n        cd server && npm install\n');
  process.exit(1);
}
if (!fs.existsSync(path.join(root, 'node_modules'))) {
  console.error('\n[dev] Frontend dependencies missing. Run this once:\n        npm install\n');
  process.exit(1);
}

const children = [];

function run(label, command, args, cwd) {
  const child = spawn(command, args, { cwd, shell: true });
  const prefix = `[${label}]`;
  const pipe = (stream, out) => {
    stream.on('data', (chunk) => {
      chunk.toString().split(/\r?\n/).forEach((line) => {
        if (line.length) out(`${prefix} ${line}`);
      });
    });
  };
  pipe(child.stdout, (l) => console.log(l));
  pipe(child.stderr, (l) => console.error(l));
  child.on('exit', (code) => {
    console.log(`${prefix} exited with code ${code}`);
    shutdown();
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach((c) => {
    if (!c.killed) {
      try { c.kill(); } catch (_) { /* ignore */ }
    }
  });
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[dev] Starting API (http://localhost:3000) and Angular (http://0.0.0.0:4200)...');
console.log('[dev] On another device on the same private network, open http://<this-computer-ip>:4200\n');

// Backend: server/package.json "start" -> node server.js
run('api', 'npm', ['start'], serverDir);
// Frontend: root "start" -> ng serve (proxies /api to :3000)
run('web', 'npm', ['start', '--', '--host', '0.0.0.0'], root);
