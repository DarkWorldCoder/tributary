'use strict';
// A small class-API fixture for process/ownership tests, not an ESLint rules engine.
const fs = require('node:fs'); const path = require('node:path'); const { mkdtemp } = require('./tmp');
function eslintFixture(t) {
  const root = mkdtemp('eslint-api');
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  put('package.json', '{"name":"lint-fixture","private":true}'); put('sample.js', 'var answer = missing;\n'); put('other.ts', 'const answer: number = 1;\n');
  put('eslint.config.cjs', 'module.exports = [];');
  put('node_modules/eslint/package.json', '{"name":"eslint","version":"9.0.0","main":"index.cjs"}');
  put('node_modules/eslint/index.cjs', `
    const fs = require('node:fs'), path = require('node:path');
    fs.writeFileSync(path.join(__dirname, 'loaded'), String(process.pid));
    class ESLint {
      constructor(options) { this.options = options; }
      async isPathIgnored(filename) { return filename.endsWith('ignored.js'); }
      async lintText(text) {
        if (text.includes('SLOW')) await new Promise(resolve => setTimeout(resolve, 450));
        if (text.includes('HANG')) await new Promise(() => {});
        if (text.includes('FLOOD')) process.stdout.write('x'.repeat(5 * 1024 * 1024));
        if (text.includes('THROW')) throw Error('fixture config failure');
        const rule = fs.readFileSync(path.join(this.options.cwd, 'eslint.config.cjs'), 'utf8').includes('new-rule') ? 'new-rule' : 'fixture-rule';
        return [{ messages: [{ severity: 2, ruleId: rule, line: 1, column: 1, endLine: 1, endColumn: 4, message: text.slice(0, 80) }], ...(this.options.fix ? { output: text.replace(/\\bvar\\b/g, 'let') } : {}) }];
      }
    }
    module.exports = { ESLint, loadESLint: async () => ESLint };
  `);
  // helpers/tmp removes the process-owned scratch parent after worker cleanup.
  return { root, put };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { const deadline = Date.now() + 5000; while (!predicate()) { if (Date.now() > deadline) throw Error('Timed out waiting for process state'); await delay(10); } }
module.exports = { eslintFixture, delay, until };
