'use strict';
// Versioned release snapshots keep main free of automated version-bump pushes.
const fs = require('node:fs'); const path = require('node:path'); const { execFileSync } = require('node:child_process');
const manifests = ['package.json', 'package-lock.json', 'ui/package.json', 'ui/package-lock.json', 'vscode/package.json'];
function versionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw Error('Expected a numeric major.minor.patch version');
  const parts = version.split('.').map(Number);
  if (parts.some(part => part > 65535)) throw Error('Version exceeds Windows installer limits');
  return parts;
}
const compare = (a, b) => { const x = versionParts(a), y = versionParts(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
function nextVersion(current, tags) {
  versionParts(current);
  const versions = tags.filter(tag => /^v\d+\.\d+\.\d+$/.test(tag)).map(tag => tag.slice(1));
  const highest = versions.sort(compare).at(-1);
  if (!highest || compare(current, highest) > 0) return current;
  const parts = versionParts(highest); parts[2]++; const next = parts.join('.'); versionParts(next); return next;
}
function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function tagVersion(tag) { if (!tag?.startsWith('v')) throw Error('Expected a vX.Y.Z tag'); versionParts(tag.slice(1)); return tag.slice(1); }
function planRelease(root, source, manualTag) {
  if (!/^[a-f0-9]{40}$/.test(source || '')) throw Error('Expected an exact source commit SHA');
  git(root, ['cat-file', '-e', source + '^{commit}']);
  if (manualTag) {
    const version = tagVersion(manualTag), commit = git(root, ['rev-parse', manualTag + '^{commit}']);
    if (JSON.parse(git(root, ['show', commit + ':package.json'])).version !== version) throw Error('Existing tag must match its package version');
    return { source: commit, tag: manualTag, version, automatic: false };
  }
  const tags = git(root, ['tag', '--list', 'v*']).split('\n').filter(tag => /^v\d+\.\d+\.\d+$/.test(tag));
  // A successful rerun reuses the same immutable source snapshot and tag.
  for (const tag of tags) {
    const commit = git(root, ['rev-parse', tag + '^{commit}']);
    const body = git(root, ['show', '-s', '--format=%B', commit]);
    if (commit === source || body.split('\n').includes('Tributary-Source: ' + source)) {
      const version = tagVersion(tag);
      if (JSON.parse(git(root, ['show', commit + ':package.json'])).version === version) return { source, tag, version, automatic: true };
    }
  }
  const version = nextVersion(JSON.parse(git(root, ['show', source + ':package.json'])).version, tags);
  return { source, tag: 'v' + version, version, automatic: true };
}
function applyVersion(root, version) {
  versionParts(version);
  for (const file of manifests) {
    const full = path.join(root, file), data = JSON.parse(fs.readFileSync(full, 'utf8'));
    data.version = version; if (data.packages?.['']) data.packages[''].version = version;
    fs.writeFileSync(full, JSON.stringify(data, null, 2) + '\n');
  }
}
function tagRelease(root, plan) {
  tagVersion(plan.tag);
  if (plan.version !== plan.tag.slice(1)) throw Error('Mismatched release version');
  if (git(root, ['rev-parse', 'HEAD']) !== plan.source) throw Error('Release checkout differs from planned source');
  applyVersion(root, plan.version);
  git(root, ['add', '--', ...manifests]); const tree = git(root, ['write-tree']);
  const exists = git(root, ['tag', '--list', plan.tag]) === plan.tag;
  if (exists) {
    if (git(root, ['rev-parse', plan.tag + '^{tree}']) !== tree) throw Error('Existing release tag has different content; refusing to overwrite');
    return git(root, ['rev-parse', plan.tag + '^{commit}']);
  }
  if (!plan.automatic) throw Error('Manual release requires an existing tag');
  const commit = git(root, ['rev-parse', 'HEAD^{tree}']) === tree ? plan.source : git(root, ['commit-tree', tree, '-p', plan.source, '-m', `Release ${plan.tag}\n\nTributary-Source: ${plan.source}`]);
  git(root, ['tag', '-a', plan.tag, commit, '-m', `Tributary ${plan.tag}`]);
  return commit;
}
module.exports = { nextVersion, versionParts, planRelease, applyVersion, tagRelease, manifests };
if (require.main === module) {
  const root = path.resolve(__dirname, '..'), command = process.argv[2];
  if (command === 'plan') {
    const plan = planRelease(root, process.env.RELEASE_SOURCE, process.env.RELEASE_MANUAL_TAG);
    fs.writeFileSync('release-plan.json', JSON.stringify(plan) + '\n');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
    console.log(JSON.stringify(plan));
  } else if (command === 'prepare') applyVersion(root, process.env.RELEASE_VERSION);
  else if (command === 'tag') console.log(tagRelease(root, { source: process.env.RELEASE_SOURCE, tag: process.env.RELEASE_TAG, version: process.env.RELEASE_VERSION, automatic: process.env.RELEASE_AUTOMATIC === 'true' }));
  else throw Error('Expected plan, prepare or tag');
}
