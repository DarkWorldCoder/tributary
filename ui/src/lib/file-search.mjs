/** Cancel the producer as well as ignoring an obsolete reply. */
export function fileSearch(hub, project, query, options) {
  let current = true, owner = null;
  const close = () => { const token = owner; owner = null; if (token) void hub.call('fileSearchClose', token).catch(() => {}); };
  const result = hub.call('fileSearchAcquire', project).then(token => {
    owner = token;
    if (!current) { close(); throw new Error('File search cancelled'); }
    return hub.call('fileSearch', token, query, options).then(value => {
      if (value.cancelled) throw new Error('File search cancelled');
      return value;
    });
  }).finally(close);
  return { result, cancel() { current = false; close(); } };
}
