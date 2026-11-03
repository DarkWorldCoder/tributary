'use strict';
// Per-process scratch space for tests. Every folder lives under one parent in
// os.tmpdir() that is removed when the process exits, so a test run leaves
// nothing behind in /tmp.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PREFIX = 'tributary-run-';
let parent = null;

function cleanup() {
  const dir = parent;
  parent = null;
  if (!dir) return;
  // Only ever remove the folder this process created, directly under tmpdir.
  if (path.dirname(dir) !== fs.realpathSync(os.tmpdir()) || !path.basename(dir).startsWith(PREFIX)) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function root() {
  if (parent) return parent;
  parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), PREFIX));
  process.once('exit', cleanup);
  // Run the exit handler when a run is interrupted too.
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(sig, () => process.exit(code));
  }
  return parent;
}

// fs.mkdtempSync-alike: a fresh folder named <name>-XXXXXX under the run's parent.
function mkdtemp(name) {
  return fs.mkdtempSync(path.join(root(), `${name}-`));
}

// Point checkpoints at a scratch folder unless the caller already chose one.
function useCheckpointDir() {
  process.env.TRIBUTARY_CHECKPOINT_DIR = process.env.TRIBUTARY_CHECKPOINT_DIR || mkdtemp('ckpt');
}

module.exports = { mkdtemp, useCheckpointDir, root };
