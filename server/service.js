'use strict';
// A single-process, self-hosted coordination service. It never executes agent commands.
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const hash = (s) => createHash('sha256').update(s).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function text(value, label, max, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, `${label} must be ${required ? 'nonempty and ' : ''}at most ${max} characters.`);
  return value.trim();
}
const states = new Set(['claimed', 'working', 'blocked', 'review', 'done']);

function createService({ dbPath, bootstrapToken, ownerName = 'Project owner', publicOrigin, tls, uiDir = path.join(__dirname, '..', 'ui', 'dist') }) {
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use an HTTPS public origin without credentials, paths or query parameters.');
    publicOrigin = url.origin;
  }
  if (tls && (!tls.cert || !tls.key)) throw new Error('TLS requires both a certificate and a private key.');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  fs.chmodSync(dbPath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, admin INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS members(project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(project_id,user_id));
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(project_id TEXT NOT NULL, cursor INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(project_id,cursor));
    CREATE TABLE IF NOT EXISTS commands(actor_id TEXT NOT NULL, command_id TEXT NOT NULL, payload_hash TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(actor_id,command_id));
    CREATE TABLE IF NOT EXISTS age_keys(user_id TEXT PRIMARY KEY REFERENCES users(id), recipient TEXT NOT NULL);`);
  let bootstrap = null;
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    bootstrap = bootstrapToken || randomBytes(32).toString('base64url');
    if (bootstrap.length < 32) throw new Error('Owner access key must contain at least 32 characters.');
    db.prepare('INSERT INTO users VALUES(?,?,?,1)').run(randomUUID(), text(ownerName, 'Owner name', 80), hash(bootstrap));
  }
  const rooms = new Map();
  const connections = new Set();
  const tx = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const v = fn(); db.exec('COMMIT'); return v; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const auth = (req) => {
    const token = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.authorization || '')?.[1];
    const user = token && db.prepare('SELECT id,name,admin FROM users WHERE token_hash=?').get(hash(token));
    if (!user) fail(401, 'The access key is invalid. Ask the project owner for a new invitation.');
    return { ...user, admin: !!user.admin };
  };
  const access = (user, id) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    if (!p || !db.prepare('SELECT 1 FROM members WHERE project_id=? AND user_id=?').get(id, user.id)) fail(403, 'You do not have access to this project.');
    return p;
  };
  const tasks = (id) => db.prepare('SELECT data FROM tasks WHERE project_id=? ORDER BY rowid DESC').all(id).map((r) => JSON.parse(r.data));
  const snapshot = (user, id) => {
    const project = access(user, id);
    const members = db.prepare('SELECT u.id,u.name,u.admin,k.recipient AS ageKey FROM users u JOIN members m ON u.id=m.user_id LEFT JOIN age_keys k ON k.user_id=u.id WHERE m.project_id=? ORDER BY u.name').all(id).map((u) => ({ ...u, admin: !!u.admin, ageKey: u.ageKey || undefined }));
    return { project, tasks: tasks(id), members, online: [...new Set([...(rooms.get(id) || [])].map((c) => c.user.id))] };
  };
  const record = (id, payload) => {
    const { cursor } = db.prepare('UPDATE projects SET cursor=cursor+1 WHERE id=? RETURNING cursor').get(id);
    const e = { cursor, ...payload };
    db.prepare('INSERT INTO events VALUES(?,?,?)').run(id, cursor, JSON.stringify(e));
    return e;
  };
  function frame(c, event, data) {
    if (c.res.writableEnded) return;
    if (c.res.destroyed || c.res.writableLength > 256 * 1024) { c.res.destroy(); return; }
    c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  const presence = (id) => { const room = rooms.get(id); for (const c of room || []) frame(c, 'presence', [...new Set([...room].map((x) => x.user.id))]); };
  const publish = (id, event) => { for (const c of rooms.get(id) || []) frame(c, 'update', event); };
  const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
  async function body(req) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > 48 * 1024) fail(413, 'The request is too large.'); chunks.push(c); }
    try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!v || Array.isArray(v) || typeof v !== 'object') throw new Error(); return v; }
    catch { fail(400, 'Send a JSON object.'); }
  }
  function command(user, key, payload, mutate) {
    if (typeof key !== 'string' || !/^[\w-]{8,100}$/.test(key)) fail(400, 'A valid command ID is required.');
    return tx(() => {
      const fingerprint = hash(JSON.stringify(payload));
      const old = db.prepare('SELECT * FROM commands WHERE actor_id=? AND command_id=?').get(user.id, key);
      if (old) { if (old.payload_hash !== fingerprint) fail(409, 'This command ID was already used for a different request.'); return { result: JSON.parse(old.response), replay: true }; }
      const value = mutate();
      // Invitations intentionally return a key only once; it is never stored in this command log.
      db.prepare('INSERT INTO commands VALUES(?,?,?,?)').run(user.id, key, fingerprint, JSON.stringify(value.result.accessKey ? { ...value.result, accessKey: undefined, invitationDelivered: true } : value.result));
      return value;
    });
  }
  const handler = async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    try {
      const host = req.headers.host || '';
      const expected = publicOrigin ? new URL(publicOrigin) : null;
      if (expected ? host !== expected.host : !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) fail(403, 'Unrecognized service host. Configure TRIBUTARY_PUBLIC_ORIGIN for a shared server.');
      const origin = expected?.origin || `${req.socket.encrypted ? 'https' : 'http'}://${host}`;
      if (req.headers.origin && req.headers.origin !== origin) fail(403, 'This origin is not allowed.');
      const u = new URL(req.url, origin);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'api') {
        if (req.method !== 'GET') fail(405, 'Method not allowed.');
        if (u.pathname === '/') { res.writeHead(302, { location: '/room' }); res.end(); return; }
        // Serve only built frontend assets. No project directory or server data is exposed.
        const rel = u.pathname === '/' || u.pathname === '/room' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\//, '');
        if (!(rel === 'index.html' || /^(assets\/[\w.-]+|logo\.svg|favicon\.png)$/.test(rel))) fail(404, 'Not found.');
        const file = path.join(uiDir, rel);
        if (!fs.existsSync(file)) fail(404, 'Build the interface with npm run build:ui first.');
        const ext = path.extname(file);
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png' };
        res.setHeader('content-type', types[ext] || 'application/octet-stream');
        res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
        fs.createReadStream(file).pipe(res); return;
      }
      const input = req.method === 'POST' ? await body(req) : null;
      const user = auth(req);
      if (req.method === 'GET' && u.pathname === '/api/me') {
        const projects = db.prepare('SELECT p.* FROM projects p JOIN members m ON p.id=m.project_id WHERE m.user_id=? ORDER BY p.rowid').all(user.id);
        return json(res, 200, { user, projects });
      }
      const id = parts[2];
      if (req.method === 'GET' && parts[1] === 'projects' && parts[3] === 'snapshot' && parts.length === 4) return json(res, 200, snapshot(user, id));
      if (req.method === 'GET' && parts[1] === 'projects' && parts[3] === 'events' && parts.length === 4) {
        const p = access(user, id);
        const cursor = Number(req.headers['last-event-id'] || u.searchParams.get('after') || 0);
        if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > p.cursor) fail(400, 'Invalid event cursor.');
        if (connections.size >= 100 || [...connections].filter((c) => c.user.id === user.id).length >= 8) fail(429, 'Too many live connections. Close an unused project view.');
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        const c = { res, user, project: id }; connections.add(c);
        if (!rooms.has(id)) rooms.set(id, new Set()); rooms.get(id).add(c);
        const missed = db.prepare('SELECT data FROM events WHERE project_id=? AND cursor>? ORDER BY cursor LIMIT 501').all(id, cursor);
        if (missed.length > 500) { frame(c, 'resync', {}); res.end(); }
        else { for (const row of missed) frame(c, 'update', JSON.parse(row.data)); presence(id); }
        const timer = setInterval(() => {
          try { access(user, id); frame(c, 'heartbeat', {}); } catch { frame(c, 'revoked', {}); res.end(); }
        }, 15000);
        res.on('close', () => { clearInterval(timer); connections.delete(c); rooms.get(id)?.delete(c); if (!rooms.get(id)?.size) rooms.delete(id); presence(id); });
        return;
      }
      if (req.method !== 'POST') fail(404, 'Unknown route.');
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'Use application/json.');
      if (parts[1] === 'projects' && id) access(user, id);
      const committed = command(user, req.headers['x-command-id'], { method: req.method, path: u.pathname, input }, () => {
        if (u.pathname === '/api/projects') {
          if (!user.admin) fail(403, 'Only the server owner can create a project.');
          const p = { id: randomUUID(), name: text(input.name, 'Project name', 100), cursor: 0 };
          db.prepare('INSERT INTO projects VALUES(?,?,0)').run(p.id, p.name);
          db.prepare('INSERT INTO members VALUES(?,?)').run(p.id, user.id);
          return { result: p };
        }
        if (parts[1] !== 'projects' || !id) fail(404, 'Unknown route.');
        if (parts[3] === 'invite' && parts.length === 4) {
          if (!user.admin) fail(403, 'Only the server owner can invite teammates.');
          const key = randomBytes(32).toString('base64url'); const member = { id: randomUUID(), name: text(input.name, 'Teammate name', 80), admin: false };
          db.prepare('INSERT INTO users VALUES(?,?,?,0)').run(member.id, member.name, hash(key));
          db.prepare('INSERT INTO members VALUES(?,?)').run(id, member.id);
          return { result: { member, accessKey: key }, event: record(id, { kind: 'member', member }) };
        }
        if (parts[3] === 'revoke' && parts.length === 4) {
          if (!user.admin || input.userId === user.id) fail(403, 'Only the owner can remove a teammate.');
          if (!db.prepare('DELETE FROM members WHERE project_id=? AND user_id=?').run(id, input.userId).changes) fail(404, 'Teammate not found.');
          return { result: { removed: input.userId }, event: record(id, { kind: 'removed', userId: input.userId }) };
        }
        // A member's age public key, so teammates can add them to the repository's team secrets. Never a private key.
        if (parts[3] === 'age-key' && parts.length === 4) {
          if (typeof input.recipient !== 'string' || !/^age1[02-9ac-hj-np-z]{58}$/.test(input.recipient)) fail(400, 'Share an age public key: age1 followed by 58 characters.');
          db.prepare('INSERT INTO age_keys VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET recipient=excluded.recipient').run(user.id, input.recipient);
          return { result: { recipient: input.recipient }, event: record(id, { kind: 'member', member: { id: user.id, name: user.name, admin: user.admin, ageKey: input.recipient } }) };
        }
        if (parts[3] !== 'tasks') fail(404, 'Unknown route.');
        if (parts.length === 4) {
          if (tasks(id).length >= 1000) fail(409, 'This project has reached its 1,000-task preview limit.');
          const dependencies = input.dependencies ?? [];
          if (!Array.isArray(dependencies) || dependencies.length > 20 || dependencies.some((d) => typeof d !== 'string' || !db.prepare('SELECT 1 FROM tasks WHERE id=? AND project_id=?').get(d, id))) fail(400, 'Choose up to 20 dependencies from this project.');
          const task = { id: randomUUID(), title: text(input.title, 'Task title', 200), description: text(input.description || '', 'Task details', 12000, false), dependencies: [...new Set(dependencies)], status: 'ready', owner: null, agent: '', result: '', revision: 1, createdBy: user.id, updatedAt: Date.now() };
          db.prepare('INSERT INTO tasks VALUES(?,?,?)').run(task.id, id, JSON.stringify(task));
          return { result: task, event: record(id, { kind: 'task', task }) };
        }
        if (parts.length !== 6) fail(404, 'Unknown route.');
        const row = db.prepare('SELECT data FROM tasks WHERE id=? AND project_id=?').get(parts[4], id);
        if (!row) fail(404, 'Task not found.');
        const task = JSON.parse(row.data);
        if (!Number.isSafeInteger(input.revision) || task.revision !== input.revision) fail(409, 'This task changed. Review the latest version and try again.');
        if (parts[5] === 'claim') {
          if (task.owner || task.status !== 'ready') fail(409, 'Someone has already claimed this task.');
          for (const dep of task.dependencies) { const d = JSON.parse(db.prepare('SELECT data FROM tasks WHERE id=? AND project_id=?').get(dep, id).data); if (d.status !== 'done') fail(409, 'Finish this task’s dependencies before claiming it.'); }
          task.owner = user.id; task.agent = text(input.agent || 'My agent', 'Agent name', 100); task.status = 'claimed';
        } else if (parts[5] === 'update') {
          if (task.owner !== user.id) fail(403, 'Only the task owner can update progress.');
          if (!states.has(input.status)) fail(400, 'Choose a valid progress state.');
          task.status = input.status; task.result = text(input.result ?? task.result, 'Progress note', 6000, false);
          if (task.status === 'done' && !task.result) fail(400, 'Add a result or evidence link before marking this task done.');
        } else if (parts[5] === 'release') {
          if (!task.owner || (task.owner !== user.id && !user.admin)) fail(403, 'Only the task owner or server owner can release it.');
          task.owner = null; task.agent = ''; task.status = 'ready';
        } else fail(404, 'Unknown route.');
        task.revision++; task.updatedAt = Date.now();
        db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(task), task.id);
        return { result: task, event: record(id, { kind: 'task', task }) };
      });
      if (committed.event) {
        if (committed.event.kind === 'removed') for (const c of rooms.get(id) || []) if (c.user.id === committed.event.userId) { frame(c, 'revoked', {}); c.res.end(); }
        publish(id, committed.event);
      }
      json(res, 200, committed.result);
    } catch (e) {
      if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'The service could not complete this request.' });
      else res.end();
    }
  };
  const server = tls ? https.createServer({ cert: tls.cert, key: tls.key, minVersion: 'TLSv1.2' }, handler) : http.createServer(handler);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, bootstrapToken: bootstrap, async close() { for (const c of connections) c.res.destroy(); await new Promise((r) => { server.close(r); server.closeIdleConnections(); }); db.close(); } };
}
module.exports = { createService };
