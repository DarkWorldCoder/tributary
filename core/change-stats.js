'use strict';

// --no-renames and -z keep filenames unambiguous, including tabs and newlines.
function parseNumstat(output) {
  const files = new Map();
  for (const record of String(output || '').split('\0')) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
    if (!match) continue;
    files.set(match[3], match[1] === '-' || match[2] === '-'
      ? { binary: true }
      : { added: Number(match[1]), removed: Number(match[2]) });
  }
  return files;
}

module.exports = { parseNumstat };
