'use strict';
const fs = require('node:fs'); const path = require('node:path'); const { execFileSync } = require('node:child_process');
const { releaseAssets, hashFile } = require('./release-assets.cjs'); const { versionParts } = require('./release-version.cjs');
function publishRelease(directory, tag, run = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) {
  if (!tag?.startsWith('v')) throw Error('Expected a version tag'); versionParts(tag.slice(1));
  if (tag !== 'v' + require('../package.json').version) throw Error('Release tag must match the prepared package version');
  releaseAssets(directory);
  const files = fs.readdirSync(directory).filter(file => file === 'SHA256SUMS.txt' || /\.(?:dmg|zip|exe|AppImage|deb|tar\.gz)$/.test(file)).sort();
  const digests = new Map(files.map(file => [file, 'sha256:' + hashFile(path.join(directory, file))]));
  // The REST tag endpoint can return 404 for a draft. gh resolves both drafts
  // and public releases; read the resolved numeric API URL for asset states.
  const read = () => {
    const { apiUrl } = JSON.parse(run(['release', 'view', tag, '--json', 'apiUrl']));
    if (typeof apiUrl !== 'string' || !/^https:\/\/[^/]+\/repos\/[^/]+\/[^/]+\/releases\/\d+$/.test(apiUrl)) throw Error('Invalid release API URL');
    return JSON.parse(run(['api', apiUrl]));
  };
  let release;
  try { release = read(); } catch (error) { if (!/\b404\b|release not found/i.test(String(error.stderr || error.message))) throw error; }
  const verify = value => {
    if (!value.prerelease) throw Error('Refusing to modify a stable release');
    if (value.assets.length !== files.length || !files.every(file => value.assets.some(asset => asset.name === file && asset.state === 'uploaded' && asset.size === fs.statSync(path.join(directory, file)).size))) throw Error('Remote release assets are incomplete or differ in size');
    if (!files.every(file => value.assets.find(asset => asset.name === file).digest === digests.get(file))) throw Error('Remote release checksums are missing or differ from the verified download bytes');
  };
  if (release && !release.draft) { verify(release); return { alreadyPublished: true, url: release.html_url }; }
  if (!release) run(['release', 'create', tag, '--verify-tag', '--draft', '--prerelease', '--title', `Tributary ${tag.slice(1)} Preview`, '--notes-file', 'docs/releases/preview.md']);
  // Upload only to an unpublished draft. Public downloads are never overwritten.
  run(['release', 'upload', tag, ...files.map(file => path.resolve(directory, file)), '--clobber']);
  release = read(); verify(release);
  run(['release', 'edit', tag, '--draft=false', '--prerelease']);
  release = read(); verify(release);
  if (release.draft) throw Error('Release remains a draft after publication');
  return { alreadyPublished: false, url: release.html_url };
}
module.exports = { publishRelease };
if (require.main === module) {
  const result = publishRelease(process.argv[2] || 'release-assets', process.env.RELEASE_TAG); console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${process.env.RELEASE_TAG} ${result.alreadyPublished ? 'already published' : 'published'}\n\n[Download installers](${result.url})\n\nAll six platform/architecture builds are present: 14 installers and SHA256SUMS.txt. Uploaded asset digests match the local bytes.\n`);
}
