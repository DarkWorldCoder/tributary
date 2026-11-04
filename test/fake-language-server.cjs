// A deterministic stdio LSP fixture. No filesystem writes or network access.
let buffer = Buffer.alloc(0); const documents = new Map();
const send = (value) => { const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...value })); process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`); process.stdout.write(body); };
const diagnostic = (doc) => setTimeout(() => send({ method: 'textDocument/publishDiagnostics', params: { uri: doc.uri, version: doc.version, diagnostics: doc.text.includes('BAD') ? [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, severity: 1, message: 'Fixture server found BAD', source: 'fixture-lsp' }] : [] } }), 15);
process.stdin.on('data', (chunk) => { buffer = Buffer.concat([buffer, chunk]); while (true) { const split = buffer.indexOf('\r\n\r\n'); if (split < 0) return; const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, split).toString())[1]); if (buffer.length < split + 4 + length) return; const message = JSON.parse(buffer.subarray(split + 4, split + 4 + length)); buffer = buffer.subarray(split + 4 + length); const p = message.params;
 if (message.method === 'initialize') send({ id: message.id, result: { capabilities: { textDocumentSync: 1, completionProvider: {}, documentFormattingProvider: true, definitionProvider: true, typeDefinitionProvider: true, referencesProvider: true } } });
 else if (message.method === 'textDocument/didOpen') { documents.set(p.textDocument.uri, p.textDocument); diagnostic({ ...p.textDocument }); }
 else if (message.method === 'textDocument/didChange') { const doc = { ...documents.get(p.textDocument.uri), version: p.textDocument.version, text: p.contentChanges[0].text }; documents.set(doc.uri, doc); diagnostic(doc); }
 else if (message.method === 'textDocument/completion') send({ id: message.id, result: [{ label: 'fixtureCompletion', insertText: 'fixtureCompletion', detail: 'Real LSP response' }] });
 else if (message.method === 'textDocument/definition') { const range = { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } }; send({ id: message.id, result: [{ uri: p.textDocument.uri, range }, { uri: p.textDocument.uri, range }, { targetUri: new URL('./helper.ts', p.textDocument.uri).href, targetSelectionRange: range, targetRange: range }, { uri: new URL('./linked.ts', p.textDocument.uri).href, range }, { uri: new URL('../outside.ts', p.textDocument.uri).href, range }, { uri: 'https://example.invalid/code.ts', range }] }); }
 else if (message.method === 'textDocument/typeDefinition') send({ id: message.id, result: { uri: p.textDocument.uri, range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } } } });
 else if (message.method === 'textDocument/references') send({ id: message.id, result: p.context?.includeDeclaration ? [{ uri: p.textDocument.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } }] : [] });
 else if (message.method === 'textDocument/formatting') { const text = documents.get(p.textDocument.uri).text; const lines = text.split('\n'); send({ id: message.id, result: [{ range: { start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: lines.at(-1).length } }, newText: text.replace(/const\s+(\w+)\s*=\s*/g, 'const $1 = ') }] }); }
 else if (message.method === 'textDocument/didClose') documents.delete(p.textDocument.uri);
 else if (message.method === 'exit') process.exit(0);
 else if (message.id != null) send({ id: message.id, result: null });
 }});
process.stdin.on('end', () => process.exit(0));
