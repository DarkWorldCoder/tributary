import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerIndex } from '../ui/src/lib/explorer-index.mjs';

test('stable Explorer owner releases derived content even when old callbacks retain it', () => {
  const index=createExplorerIndex(), retainedCallback=()=>index.files;
  const files=['src/nested/one/main.ts','src/other.ts','.hidden/secret.ts'];
  assert.equal(index.acceptFiles(index.beginList(),files),true);
  index.derive('src',false,true,true);
  assert.deepEqual(index.shown,['src/nested/one/main.ts','src/other.ts']);
  index.beginSearch(); // An empty search reset must not erase the local filename projection.
  assert.deepEqual(index.shown,['src/nested/one/main.ts','src/other.ts']);
  assert.equal(index.tree[0].name,'src');assert.ok(index.chains.has('src/nested'));
  const warmChains=index.chains;index.derive('src',false,true,true);assert.equal(index.chains,warmChains);
  index.derive('src',false,false,true);assert.equal(index.chains.size,0);
  index.derive('secret',true,true,true);assert.deepEqual(index.shown,['.hidden/secret.ts']);
  index.release();assert.equal(retainedCallback(),null);assert.equal(index.shown.length,0);assert.equal(index.tree.length,0);assert.equal(index.chains.size,0);
  assert.equal(index.acceptFiles(index.beginList(),['fresh.ts']),true);index.derive('',true,true,true);assert.deepEqual(retainedCallback(),['fresh.ts']);
});

test('obsolete list/search replies cannot replace a newer list or repopulate a released owner', () => {
  const index=createExplorerIndex(),old=index.beginList(),latest=index.beginList();
  assert.equal(index.acceptFiles(latest,['new.ts']),true);assert.equal(index.acceptFiles(old,['old.ts']),false);
  const first=index.beginSearch(),second=index.beginSearch();assert.equal(index.acceptMatches(first.token,['stale.ts']),false);assert.equal(index.acceptMatches(second.token,['match.ts']),true);
  index.derive('match',true,false,true);assert.deepEqual(index.shown,['match.ts']);
  const pending=index.beginList(),search=index.beginSearch();index.release();
  assert.equal(index.acceptFiles(pending,['late.ts']),false);assert.equal(index.acceptMatches(search.token,['late.ts']),false);
  assert.equal(index.acceptFiles(index.beginList(),['new.ts']),true);assert.equal(index.acceptFiles(index.beginList(),['new.ts']),false);
  index.derive('new',true,true,false);assert.equal(index.tree.length,0);assert.equal(index.chains.size,0);
});
