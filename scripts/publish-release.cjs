'use strict';
const fs = require('node:fs'); const path = require('node:path'); const { execFileSync } = require('node:child_process');
const { releaseAssets } = require('./release-assets.cjs'); const { versionParts } = require('./release-version.cjs');
function publishRelease(directory, tag, run = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) {
  if (!tag?.startsWith('v')) throw Error('Expected a version tag'); versionParts(tag.slice(1));
  if (tag !== 'v' + require('../package.json').version) throw Error('Release tag must match the prepared package version');
  releaseAssets(directory);
  const files = fs.readdirSync(directory).filter(file => file === 'SHA256SUMS.txt' || /\.(?:dmg|zip|exe|AppImage|deb|tar\.gz)$/.test(file)).sort();
  const read = () => JSON.parse(run(['api', `repos/{owner}/{repo}/releases/tags/${tag}`]));
  let release;
  try { release = read(); } catch (error) { if (!/404|Not Found/.test(String(error.stderr || error.message))) throw error; }
  const verify = value => {
    if (!value.prerelease) throw Error('Refusing to modify a stable release');
    if (value.assets.length !== files.length || !files.every(file => value.assets.some(asset => asset.name === file && asset.state === 'uploaded' && asset.size === fs.statSync(path.join(directory, file)).size))) throw Error('Remote release assets are incomplete or differ in size');
  };
  if (release && !release.draft) { verify(release); return { alreadyPublished: true, url: release.html_url }; }
  if (!release) run(['release', 'create', tag, '--verify-tag', '--draft', '--prerelease', '--title', `Tributary ${tag.slice(1)} Preview`, '--notes-file', 'docs/releases/preview.md']);
  // Upload only to an unpublished draft. Public downloads are never overwritten.
  run(['release', 'upload', tag, ...files.map(file => path.resolve(directory, file)), '--clobber']);
  release = read(); verify(release);
  run(['release', 'edit', tag, '--draft=false', '--prerelease']);
  return { alreadyPublished: false, url: release.html_url };
}
module.exports = { publishRelease };
if (require.main === module) console.log(JSON.stringify(publishRelease(process.argv[2] || 'release-assets', process.env.RELEASE_TAG)));
