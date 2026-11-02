'use strict';
const crypto = require('crypto');

function validate(title, content) {
  if (typeof title !== 'string' || !title.trim() || title.length > 120) throw new Error('Use a document title between 1 and 120 characters.');
  if (typeof content !== 'string' || content.length > 256000) throw new Error('Document content must be text under 256,000 characters.');
  return { title: title.trim(), content };
}
function createDocument(thread, messageId) {
  const source = thread.messages.find((m) => m.id === messageId && m.role === 'assistant');
  if (!source?.text || source.ok !== true) throw new Error('Choose a completed assistant response to save as a document.');
  thread.documents ||= [];
  const existing = thread.documents.find((d) => d.sourceMessageId === messageId);
  if (existing) return existing;
  const doc = { id: crypto.randomUUID(), ...validate(thread.title.slice(0, 120), source.text), revision: 1,
    sourceMessageId: messageId, updatedAt: Date.now(), history: [] };
  thread.documents.push(doc);
  return doc;
}
function saveDocument(doc, { title, content, expectedRevision }) {
  if (expectedRevision !== doc.revision) throw new Error('This document changed since you opened it. Your draft is still available. Reload the saved version before replacing it.');
  const clean = validate(title, content);
  if (clean.title === doc.title && clean.content === doc.content) return doc;
  doc.history.push({ title: doc.title, content: doc.content, revision: doc.revision, updatedAt: doc.updatedAt });
  doc.history = doc.history.slice(-20);
  Object.assign(doc, clean, { revision: doc.revision + 1, updatedAt: Date.now() });
  return doc;
}
module.exports = { createDocument, saveDocument };
