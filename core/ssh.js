'use strict';
// SSH remote hosts, through the system `ssh` binary only. Every call shares one connection per
// target (OpenSSH ControlMaster with ControlPersist), commands are quoted for the remote shell, and
// environment variables travel on stdin so secrets never appear in a command line on the host.
//
// A remote is { target: 'user@host' or an ~/.ssh/config alias, port?, identityFile?, path: '/abs/dir' }.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PERSIST = '10m';

function checkRemote(remote) {
  const r = remote || {};
  const target = String(r.target == null ? '' : r.target).trim();
  // No leading '-' (ssh would read it as an option) and nothing a shell or ssh_config would split on.
  if (!target || target.length > 255 || target.startsWith('-') || !/^[A-Za-z0-9._@%+:[\]-]+$/.test(target)) throw new Error(`Not a valid SSH target: ${target || '(empty)'}`);
  if (r.port != null && r.port !== '' && !(/^\d+$/.test(String(r.port)) && +r.port > 0 && +r.port < 65536)) throw new Error(`Not a valid SSH port: ${r.port}`);
  if (r.path != null && r.path !== '' && !String(r.path).startsWith('/')) throw new Error(`The remote folder must be an absolute path: ${r.path}`);
  return { target, port: r.port ? Number(r.port) : undefined, identityFile: r.identityFile || undefined, path: r.path ? path.posix.normalize(String(r.path)) : undefined };
}

const controlDir = () => process.env.TRIBUTARY_SSH_CONTROL_DIR || path.join(os.homedir(), '.ssh', 'tributary');

// Options for every ssh call. mux: share the target's master connection (none on Windows, whose
// OpenSSH has no multiplexing). batch: never prompt (terminals pass false so a password prompt works).
function sshOptions(remote, { batch = true, mux = process.platform !== 'win32' } = {}) {
  const r = checkRemote(remote);
  const a = [];
  if (mux) {
    fs.mkdirSync(controlDir(), { recursive: true, mode: 0o700 });
    a.push('-o', 'ControlMaster=auto', '-o', `ControlPath=${path.join(controlDir(), '%C')}`, '-o', `ControlPersist=${PERSIST}`);
  } else a.push('-o', 'ControlMaster=no', '-o', 'ControlPath=none');
  if (batch) a.push('-o', 'BatchMode=yes');
  a.push('-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=30');
  if (r.port) a.push('-p', String(r.port));
  if (r.identityFile) a.push('-i', r.identityFile);
  return a;
}

// POSIX single-quoting: the remote shell sees exactly this string.
function quote(s) {
  s = String(s);
  if (s.includes('\0')) throw new Error('Arguments cannot contain NUL bytes');
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// Runs under /bin/sh on the host with $1 = pid file ('-' for none, relative to $HOME),
// $2 = folder ('' for $HOME) and the command after that. It records its pid (the process group,
// since sshd starts each session in its own group) so a later call can stop the whole tree, adds the
// usual user bin folders to PATH, and reads environment lines from stdin up to a blank line
// ("K=V" sets, "-K" unsets) before handing the rest of stdin to the command.
const WRAPPER = [
  'f=$1; d=$2; shift 2',
  'case $f in -|/*) ;; *) f="$PWD/$f";; esac',
  'if [ "$f" != - ]; then (umask 077; mkdir -p "${f%/*}" && echo $$ > "$f"); if [ -e "$f.cancel" ]; then rm -f "$f" "$f.cancel"; exit 143; fi; fi',
  'for p in "$HOME/.local/bin" "$HOME/bin" /usr/local/bin "$HOME/.cargo/bin" "$HOME"/.nvm/versions/node/*/bin; do [ -d "$p" ] && PATH="$PATH:$p"; done; export PATH',
  'while IFS= read -r l && [ -n "$l" ]; do case $l in -*) unset "${l#-}";; *) export "$l";; esac; done',
  'if [ -n "$d" ]; then cd "$d" || exit 126; fi',
  'if [ "$f" = - ]; then exec "$@"; fi',
  '"$@"; s=$?; rm -f "$f"; exit $s',
].join('; ');

// The command string ssh sends to the host's login shell.
function remoteCommand(cmd, args = [], { cwd = '', pidFile = '-' } = {}) {
  return ['exec', '/bin/sh', '-c', quote(WRAPPER), 'tributary', quote(pidFile), quote(cwd || ''), quote(cmd), ...args.map(quote)].join(' ');
}

// Stop a command started with a pid file: TERM (or KILL) its process group. If it has not started
// yet, wait briefly, then leave a marker so it exits as soon as it does.
function killCommand(pidFile, signal = 'TERM') {
  const f = quote(pidFile);
  return `f=${f}; i=0; while [ ! -s "$f" ] && [ $i -lt 30 ]; do sleep 0.1; i=$((i+1)); done; `
    + `if [ -s "$f" ]; then p=$(cat "$f"); kill -s ${signal} -- -"$p" 2>/dev/null || kill -s ${signal} "$p" 2>/dev/null; else : > "$f.cancel"; fi; exit 0`;
}

// Environment for the wrapper: one line per variable, then a blank line.
function envHeader(env = {}) {
  let out = '';
  for (const [k, v] of Object.entries(env || {})) {
    if (v === undefined) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`Not a valid environment variable name: ${k}`);
    if (v === null) { out += `-${k}\n`; continue; }
    if (/[\n\0]/.test(String(v))) throw new Error(`${k} contains a line break and can't be sent to the remote host`);
    out += `${k}=${v}\n`;
  }
  return `${out}\n`;
}

module.exports = { checkRemote, sshOptions, quote, remoteCommand, killCommand, envHeader, controlDir, WRAPPER };
