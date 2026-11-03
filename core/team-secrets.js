'use strict';
// Team secrets: a dotenv file encrypted with SOPS (https://getsops.io) and committed at .tributary/secrets.env. Everyone
// whose age key is listed in the repository's .sops.yaml can read it; nobody else can, a project room's server included.
// Tributary makes each person's age key and keeps it in the secret store (the OS keychain in the desktop app), and hands
// it to sops through the environment only. Decrypted values go to the environment of agents and terminals, and to the
// secret guard so transcripts redact them and commits refuse them. They are never written to disk or sent to the window.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { which, pathDirs } = require('./agents');

const FILE = '.tributary/secrets.env';
const CONFIG = '.sops.yaml';
const STORE_KEY = 'team-secrets:age-identity';
const RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;
const RECIPIENTS = /age1[02-9ac-hj-np-z]{58}/g;
const VAR = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Names that change how programs start or where they look. Any member can write the file, so it never sets these on
// a teammate's computer.
const UNSAFE = /^(PATH|HOME|SHELL|ENV|BASH_ENV|IFS|LD_\w+|DYLD_\w+|NODE_OPTIONS|NODE_PATH|PYTHON(STARTUP|PATH|HOME)|PERL5(OPT|LIB)|RUBY(OPT|LIB)|GIT_\w+|SOPS_\w+|TRIBUTARY_\w+)$/i;
const MANAGED = '# Team secrets for Tributary.';
const SOURCE = 'team secrets';

/** The member list in a .sops.yaml: [{ recipient, name }]. Names come from the comment after each key. */
function parseMembers(text) {
  const members = []; const seen = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*-?\s*(age1[02-9ac-hj-np-z]{58})\b[\s,]*(?:#\s*(.*?))?\s*$/.exec(line);
    for (const recipient of m ? [m[1]] : line.replace(/#.*/, '').match(RECIPIENTS) || []) {
      if (!seen.has(recipient)) { seen.add(recipient); members.push({ recipient, name: (m && m[2]) || '' }); }
    }
  }
  return members;
}
const cleanName = (name) => String(name || '').replace(/[\u0000-\u001f\u007f#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
/** The .sops.yaml Tributary writes: one creation rule for the secrets file, one line per member. */
function configText(members) {
  return [MANAGED, 'Every age key below can read .tributary/secrets.env. Change the list in Tributary', '(Settings, Team secrets), or edit it, then run `sops updatekeys` and, after removing someone, `sops rotate -i`.']
    .map((l, i) => i ? `# ${l}` : l).concat(['creation_rules:', "  - path_regex: '(^|[/\\\\])\\.tributary[/\\\\]secrets\\.env$'", '    key_groups:', '      - age:',
      ...members.map((m) => `          - ${m.recipient}${cleanName(m.name) ? `  # ${cleanName(m.name)}` : ''}`)]).join('\n') + '\n';
}
/** sops's dotenv format: NAME=value lines, with newlines in a value written as \n. */
function parseDotenv(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('='); if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).replace(/\\n/g, '\n');
  }
  return out;
}
const dotenvText = (values) => Object.entries(values).map(([k, v]) => `${k}=${String(v).replace(/\n/g, '\\n')}`).join('\n') + '\n';
/** What an encrypted file shows without its key: the variable names, and the age keys it is encrypted to. */
function describeFile(text) {
  const names = []; const recipients = [];
  for (const line of String(text).split('\n')) {
    const i = line.indexOf('='); if (i <= 0) continue;
    const name = line.slice(0, i);
    if (/^sops_age__list_\d+__map_recipient$/.test(name)) recipients.push(line.slice(i + 1).trim());
    else if (!name.startsWith('sops_') && !name.startsWith('#')) names.push(name);
  }
  return { names, recipients };
}
function checkName(name) {
  if (typeof name !== 'string' || !VAR.test(name) || name.length > 200) throw new Error('Use a variable name made of letters, digits and underscores, not starting with a digit.');
  // sops keeps names ending in _unencrypted in plain text, and keeps its own metadata under sops_.
  if (/^sops_/i.test(name) || /_unencrypted$/.test(name)) throw new Error('Names starting with sops_ or ending in _unencrypted are reserved by SOPS.');
  if (UNSAFE.test(name)) throw new Error(`${name} changes how programs start on each teammate's computer, so team secrets can't set it.`);
}
function checkRecipient(recipient) {
  if (typeof recipient !== 'string' || !RECIPIENT.test(recipient.trim())) throw new Error('That is not an age public key. It starts with age1 and is 62 characters long.');
  return recipient.trim();
}

const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const stamp = (file) => { try { const s = fs.statSync(file); return `${s.mtimeMs}:${s.size}:${s.ino}`; } catch { return null; } };
const firstLine = (text) => String(text).split('\n').map((l) => l.replace(/^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d /, '').trim()).find(Boolean) || 'SOPS failed';

/** Run sops with the person's identity in its environment (never on its command line or on disk). */
function sops(args, { cwd, identity, input, timeout = 30000 }) {
  const env = { ...process.env, PATH: pathDirs(process.env).join(path.delimiter) };
  const bin = which('sops', env);
  if (!bin) return Promise.reject(Object.assign(new Error('SOPS is not installed. Install it from https://getsops.io/docs/ (for example `brew install sops`), then try again.'), { code: 'NO_SOPS' }));
  if (identity) env.SOPS_AGE_KEY = identity; else delete env.SOPS_AGE_KEY;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const out = []; let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { if (err.length < 64 * 1024) err += d; });
    child.stdin.on('error', () => {});
    child.stdin.end(input == null ? '' : input);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8'));
      // Only stderr is reported; stdout could hold decrypted values.
      const noKey = /Failed to get the data key|no identity matched|0 successful groups required/i.test(err);
      reject(Object.assign(new Error(noKey ? 'Your key cannot open this project\'s team secrets yet. Ask a member to add it.' : firstLine(err)), { code: noKey ? 'NO_ACCESS' : 'SOPS' }));
    });
  });
}
const gitRoot = (dir) => new Promise((resolve) => execFile('git', ['rev-parse', '--show-toplevel'], { cwd: dir }, (e, out) => resolve(e ? dir : path.resolve(String(out).trim()))));

class TeamSecrets {
  /** store: the secret store (get/set/delete, and kind in the desktop app). guard: the hub's SecretGuard. */
  constructor(store, guard) { this.store = store; this.guard = guard; this.cache = new Map(); }

  async identity() { return (await this.store.get(STORE_KEY)) || null; }
  async key() {
    const id = await this.identity(); if (!id) return null;
    if (this.keyFor?.id !== id) this.keyFor = { id, recipient: await (await import('age-encryption')).identityToRecipient(id) };
    return this.keyFor.recipient;
  }
  /** Make this person's age key once. Returns its public half, the part teammates add. */
  async createKey() {
    if (await this.identity()) return this.key();
    const age = await import('age-encryption');
    await this.store.set(STORE_KEY, await age.generateX25519Identity());
    return this.key();
  }

  async status(dir) {
    const root = await gitRoot(dir);
    const config = read(path.join(root, CONFIG)); const file = read(path.join(root, FILE));
    const key = await this.key().catch(() => null);
    const members = config ? parseMembers(config) : [];
    const { names, recipients } = file ? describeFile(file) : { names: [], recipients: [] };
    return {
      root, file: FILE, exists: file != null, names,
      config: config == null ? 'none' : config.startsWith(MANAGED) ? 'managed' : 'other',
      members: members.map((m) => ({ ...m, you: m.recipient === key, canRead: file == null || recipients.includes(m.recipient) })),
      key, storage: this.store.kind || 'encrypted', sops: !!which('sops', process.env),
      canRead: !!key && (file == null ? members.some((m) => m.recipient === key) : recipients.includes(key)),
    };
  }

  /**
   * The team's values for processes started in dir: { env, error }. Decrypted when the file changes, held in memory,
   * and taught to the secret guard. A project without the file gets { env: {} }.
   */
  async env(dir) {
    if (!dir) return { env: {}, error: null };
    const root = await gitRoot(dir); const file = path.join(root, FILE);
    const s = stamp(file); if (!s) return { env: {}, error: null };
    const identity = await this.identity().catch(() => null);
    if (!identity) return { env: {}, error: 'you have no team secrets key yet. Create one in Settings, Team secrets, and ask a member to add it.' };
    const hit = this.cache.get(root);
    if (hit && hit.stamp === s && hit.identity === identity) return hit.result;
    try {
      const values = parseDotenv(await sops(['decrypt', '--input-type', 'dotenv', '--output-type', 'dotenv', FILE], { cwd: root, identity }));
      for (const [name, value] of Object.entries(values)) this.guard?.add(value, `${name} from ${SOURCE}`);
      const result = { env: Object.fromEntries(Object.entries(values).filter(([name]) => !UNSAFE.test(name))), error: null };
      this.cache.set(root, { stamp: s, identity, result }); // failures are not kept: a key added or sops installed counts next time
      return result;
    } catch (e) { return { env: {}, error: e.message }; }
  }
  async values(root) {
    if (!fs.existsSync(path.join(root, FILE))) return {};
    const r = await this.env(root); if (r.error) throw new Error(r.error);
    return { ...r.env };
  }

  /** Start sharing in a repository: a .sops.yaml that lists only you. */
  async start(dir, name) {
    const root = await gitRoot(dir);
    if (fs.existsSync(path.join(root, CONFIG))) throw new Error('This repository already has a .sops.yaml.');
    const recipient = await this.createKey();
    fs.writeFileSync(path.join(root, CONFIG), configText([{ recipient, name }]));
    return this.status(root);
  }
  writeConfig(root, members) {
    const config = read(path.join(root, CONFIG));
    if (config != null && !config.startsWith(MANAGED)) throw new Error('This repository\'s .sops.yaml was not made by Tributary, so change its age keys by hand and run `sops updatekeys .tributary/secrets.env`.');
    fs.writeFileSync(path.join(root, CONFIG), configText(members));
  }
  async encrypt(root, values) {
    const out = await sops(['encrypt', '--filename-override', FILE, '--input-type', 'dotenv', '--output-type', 'dotenv'], { cwd: root, input: dotenvText(values) });
    fs.mkdirSync(path.join(root, '.tributary'), { recursive: true });
    fs.writeFileSync(path.join(root, FILE), out);
    this.cache.delete(root);
  }

  /** Set one value, or remove it with null. The file is encrypted afresh, with a new data key. */
  async setValue(dir, name, value) {
    checkName(name);
    const root = await gitRoot(dir);
    if (!parseMembers(read(path.join(root, CONFIG)) || '').length) throw new Error('Start team secrets in this project first.');
    const values = await this.values(root);
    if (value == null) delete values[name];
    else if (typeof value !== 'string' || value.length > 64 * 1024) throw new Error('Values are text, up to 64 KB.');
    else values[name] = value;
    await this.encrypt(root, values);
    for (const [k, v] of Object.entries(values)) this.guard?.add(v, `${k} from ${SOURCE}`);
    return this.status(root);
  }

  /** Add a teammate's age key, and re-encrypt the file's data key so they can read it. */
  async addMember(dir, { name, recipient }) {
    recipient = checkRecipient(recipient);
    const root = await gitRoot(dir);
    const members = parseMembers(read(path.join(root, CONFIG)) || '');
    if (!members.length) throw new Error('Start team secrets in this project first.');
    if (members.some((m) => m.recipient === recipient)) throw new Error('That key is already a member.');
    const identity = await this.identity();
    if (fs.existsSync(path.join(root, FILE)) && !identity) throw new Error('Create your own key first; only a member can add another.');
    this.writeConfig(root, [...members, { recipient, name }]);
    if (fs.existsSync(path.join(root, FILE))) {
      try { await sops(['updatekeys', '--yes', '--input-type', 'dotenv', FILE], { cwd: root, identity }); } catch (e) { this.writeConfig(root, members); throw e; }
    }
    this.cache.delete(root);
    return this.status(root);
  }

  /**
   * Remove a member: drop their key, re-encrypt the data key to everyone else (sops updatekeys), then replace the data
   * key itself (sops rotate). They can still read any copy of the file they already had, and git history keeps the
   * old one, so every value they could read must also be changed where it was issued; `rotate` lists those names.
   */
  async removeMember(dir, recipient) {
    const root = await gitRoot(dir);
    const members = parseMembers(read(path.join(root, CONFIG)) || '');
    const gone = members.find((m) => m.recipient === recipient); if (!gone) throw new Error('That key is not a member.');
    if (gone.recipient === await this.key()) throw new Error('You cannot remove your own key. Ask another member to remove it.');
    const identity = await this.identity();
    const exists = fs.existsSync(path.join(root, FILE));
    const names = exists ? describeFile(read(path.join(root, FILE))).names : [];
    if (exists) await this.values(root); // fails early, before the list changes, if you cannot read the file
    this.writeConfig(root, members.filter((m) => m !== gone));
    if (exists) {
      try { await sops(['updatekeys', '--yes', '--input-type', 'dotenv', FILE], { cwd: root, identity }); } catch (e) { this.writeConfig(root, members); throw e; }
      try { await sops(['rotate', '--in-place', '--input-type', 'dotenv', '--output-type', 'dotenv', FILE], { cwd: root, identity }); } catch (e) {
        this.cache.delete(root);
        throw new Error(`Their key is removed, but the data key was not replaced (${e.message}). Run \`sops rotate -i ${FILE}\` in the project.`);
      }
    }
    this.cache.delete(root);
    return { status: await this.status(root), removed: gone, rotate: names };
  }
}

module.exports = { TeamSecrets, parseMembers, configText, parseDotenv, dotenvText, describeFile, checkRecipient, FILE, CONFIG, STORE_KEY, sops };
