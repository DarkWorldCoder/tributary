'use strict';
// App-owned guidance is bundled with both hosts. Loading it never installs or runs anything.
const fs = require('fs');
const path = require('path');

const catalog = [
  { id: 'tributary-ui-layout', title: 'Layout & typography', description: 'Improve text placement, spacing and layouts at different window sizes.' },
  { id: 'tributary-ui-writing', title: 'Clear interface writing', description: 'Make labels, instructions, errors and empty states easier to understand.' },
  { id: 'tributary-ui-components', title: 'Choose UI components', description: 'Use the right controls and extend the project’s existing component library.' },
  { id: 'tributary-ui-review', title: 'Review usability', description: 'Check keyboard access, readability and real screens before calling the work done.' },
];
function listUiSkills() { return catalog.map((entry) => ({ ...entry })); }
function readUiSkill(id) {
  const entry = catalog.find((skill) => skill.id === id);
  if (!entry) throw new Error('Unknown UI skill.');
  const source = fs.readFileSync(path.join(__dirname, 'bundled-skills', id, 'SKILL.md'), 'utf8');
  if (Buffer.byteLength(source) > 16000) throw new Error('UI skill exceeds its size limit.');
  const instructions = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  if (!instructions) throw new Error('UI skill is empty.');
  return { ...entry, instructions };
}
module.exports = { listUiSkills, readUiSkill };
