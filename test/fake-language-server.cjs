// A deterministic stdio LSP fixture. No filesystem writes or network access.
const delayed = (kind, fn) => process.argv.includes(`--slow-${kind}`) ? setTimeout(fn, 100) : fn();
let buffer = Buffer.alloc(0); const documents = new Map();
let writing = Promise.resolve();
const sendBytes = (body) => {
 const bytes = Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
 if (!process.argv.includes('--fragmented-output')) { process.stdout.write(bytes); return; }
 // Serialize whole frames while splitting headers and UTF-8 bodies across real
 // stdio writes. Concurrent notifications must never interleave frame bytes.
 writing = writing.then(async () => {
  const sizes = [1, 2, 3, 7, 11, 2, 1]; let offset = 0; let index = 0;
  while (offset < bytes.length) { const size = sizes[index++] || 113; process.stdout.write(bytes.subarray(offset, offset + size)); offset += size; await new Promise((resolve) => setTimeout(resolve, 1)); }
 });
};
const send = (value) => sendBytes(Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...value })));
const diagnostic = (doc) => setTimeout(() => send({ method: 'textDocument/publishDiagnostics', params: { uri: doc.uri, version: doc.version, diagnostics: doc.text.includes('BAD') ? [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, severity: 1, message: 'Fixture server found BAD', source: 'fixture-lsp' }] : [] } }), 15);
process.stdin.on('data', (chunk) => { buffer = Buffer.concat([buffer, chunk]); while (true) { const split = buffer.indexOf('\r\n\r\n'); if (split < 0) return; const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, split).toString())[1]); if (buffer.length < split + 4 + length) return; const message = JSON.parse(buffer.subarray(split + 4, split + 4 + length)); buffer = buffer.subarray(split + 4 + length); const p = message.params;
 if (message.method === 'initialize') delayed('init', () => {
  if (process.argv.includes('--null-init')) { sendBytes(Buffer.from('null')); return; }
  if (process.argv.includes('--truncated-init')) { process.stdout.end('Content-Length: 100\r\n\r\npartial'); return; }
  if (process.argv.includes('--empty-init')) { process.stdout.end(); return; }
  send({ id: message.id, result: { capabilities: { textDocumentSync: 1, completionProvider: {}, documentFormattingProvider: true, definitionProvider: true, typeDefinitionProvider: true, referencesProvider: true } } });
 });
 else if (message.method === 'textDocument/didOpen') { documents.set(p.textDocument.uri, p.textDocument); diagnostic({ ...p.textDocument }); }
 else if (message.method === 'textDocument/didChange') { const doc = { ...documents.get(p.textDocument.uri), version: p.textDocument.version, text: p.contentChanges[0].text }; documents.set(doc.uri, doc); diagnostic(doc); }
 else if (message.method === 'textDocument/completion') send({ id: message.id, result: [{ label: process.argv.includes('--unicode') ? 'fixtureCompletion🙂नमस्ते' : 'fixtureCompletion', insertText: 'fixtureCompletion', detail: process.argv.includes('--unicode') ? 'नमस्ते 🙂 café '.repeat(300) : 'Real LSP response' }] });
 else if (message.method === 'textDocument/definition') { const range = { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } }; send({ id: message.id, result: [{ uri: p.textDocument.uri, range }, { uri: p.textDocument.uri, range }, { targetUri: new URL('./helper.ts', p.textDocument.uri).href, targetSelectionRange: range, targetRange: range }, { uri: new URL('./linked.ts', p.textDocument.uri).href, range }, { uri: new URL('../outside.ts', p.textDocument.uri).href, range }, { uri: 'https://example.invalid/code.ts', range }] }); }
 else if (message.method === 'textDocument/typeDefinition') send({ id: message.id, result: { uri: p.textDocument.uri, range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } } } });
 else if (message.method === 'textDocument/references') send({ id: message.id, result: p.context?.includeDeclaration ? [{ uri: p.textDocument.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } }] : [] });
 else if (message.method === 'textDocument/formatting') { const text = documents.get(p.textDocument.uri).text; const lines = text.split('\n'); delayed('format', () => send({ id: message.id, result: [{ range: { start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: lines.at(-1).length } }, newText: text.replace(/const\s+(\w+)\s*=\s*/g, 'const $1 = ') }] })); }
 else if (message.method === 'textDocument/didClose') documents.delete(p.textDocument.uri);
 else if (message.method === 'exit') process.exit(0);
 else if (message.id != null) send({ id: message.id, result: null });
 }});
process.stdin.on('end', () => process.exit(0));
