// Shared browser/desktop client. Access keys stay in memory and never enter public state.
export class CollaborationClient {
  constructor(onChange = () => {}, requestFetch = (...args) => fetch(...args)) {
    this.requestFetch = requestFetch;
    this.onChange = onChange; this.generation = 0; this.token = ''; this.controller = null; this.pending = new Map();
    this.value = { status: 'disconnected', endpoint: '', user: null, projects: [], snapshot: null, error: null };
  }
  state() { return structuredClone(this.value); }
  emit() { this.onChange(this.state()); }
  async request(route, input, commandId, signal) {
    const r = await this.requestFetch(this.value.endpoint + route, { method: input ? 'POST' : 'GET', redirect: 'error', signal: signal || AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${this.token}`, ...(input ? { 'content-type': 'application/json', 'x-command-id': commandId } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) }, this.fingerprint);
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw Object.assign(new Error(typeof data.error === 'string' ? data.error.slice(0, 300) : `Project service returned ${r.status}.`), { status: r.status });
    }
    return r;
  }
  async connect({ endpoint, accessKey, fingerprint }) {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the service address without a path, password or query.');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS for a shared server, or HTTP on this computer.');
    if (typeof accessKey !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(accessKey.trim())) throw new Error('Enter the access key from your invitation.');
    this.disconnect();
    const generation = this.generation;
    if (fingerprint && !/^[a-fA-F0-9:]{64,95}$/.test(fingerprint)) throw new Error('Enter the certificate fingerprint from the owner.');
    this.fingerprint = fingerprint || '';
    this.token = accessKey.trim(); this.value.endpoint = url.origin;
    this.value.status = 'connecting'; this.emit();
    try {
      const me = await (await this.request('/api/me')).json();
      if (generation !== this.generation) return this.state();
      Object.assign(this.value, me, { status: 'connected', error: null }); this.emit();
      if (me.projects.length) await this.watch(me.projects[0].id);
      return this.state();
    } catch (e) {
      if (generation === this.generation) { this.token = ''; this.value.status = 'disconnected'; this.value.error = e.message; this.emit(); }
      throw e;
    }
  }
  disconnect() {
    this.generation++; this.controller?.abort(); this.controller = null; this.token = '';
    this.pending.clear(); this.fingerprint = '';
    this.value = { status: 'disconnected', endpoint: '', user: null, projects: [], snapshot: null, error: null }; this.emit();
  }
  async command(action, input, commandId = crypto.randomUUID()) {
    if (!this.token) throw new Error('Connect to a project service first.');
    const generation = this.generation; const id = this.value.snapshot?.project.id;
    const routes = { createProject: '/api/projects', invite: `/api/projects/${id}/invite`, revoke: `/api/projects/${id}/revoke`, createTask: `/api/projects/${id}/tasks`, claim: `/api/projects/${id}/tasks/${encodeURIComponent(input.id || '')}/claim`, update: `/api/projects/${id}/tasks/${encodeURIComponent(input.id || '')}/update`, release: `/api/projects/${id}/tasks/${encodeURIComponent(input.id || '')}/release` };
    if (!Object.hasOwn(routes, action) || (action !== 'createProject' && !id)) throw new Error('Choose a project and a supported action.');
    const fingerprint = JSON.stringify([routes[action], input]);
    const key = this.pending.get(fingerprint) || commandId; this.pending.set(fingerprint, key);
    let result;
    try { result = await (await this.request(routes[action], input, key)).json(); this.pending.delete(fingerprint); }
    catch (e) { if (e.status) this.pending.delete(fingerprint); else throw new Error('The request outcome is uncertain. Retry the same action to check it without creating a duplicate.'); throw e; }
    if (generation !== this.generation) throw new Error('The connection changed while this request was completing. Reconnect to inspect its outcome.');
    if (action === 'createProject') {
      const me = await (await this.request('/api/me')).json(); Object.assign(this.value, me); await this.watch(result.id);
    } else if (id) {
      // Read a fresh snapshot; commands and stream delivery can race safely by cursor.
      await this.refresh(id, generation);
    }
    return result;
  }
  async refresh(id, generation = this.generation) {
    const snapshot = await (await this.request(`/api/projects/${encodeURIComponent(id)}/snapshot`)).json();
    if (generation !== this.generation || this.project !== id) return;
    if (!this.value.snapshot || snapshot.project.cursor >= this.value.snapshot.project.cursor) this.value.snapshot = snapshot;
    this.emit();
  }
  async watch(id) {
    if (!this.token) throw new Error('Connect first.');
    if (!this.value.projects.some((p) => p.id === id)) throw new Error('Unknown project.');
    this.controller?.abort(); this.controller = new AbortController(); const signal = this.controller.signal;
    const generation = ++this.generation; this.project = id;
    this.value.snapshot = null; this.value.status = 'connecting'; this.value.error = null; this.emit();
    await this.refresh(id, generation);
    if (signal.aborted) return this.state();
    this.stream(id, generation, signal).catch(() => {});
    return this.state();
  }
  async stream(id, generation, signal) {
    let delay = 300;
    while (!signal.aborted && generation === this.generation) {
      let watchdog;
      const attempt = new AbortController();
      const reset = () => { clearTimeout(watchdog); watchdog = setTimeout(() => attempt.abort(), 35000); };
      try {
        reset();
        const r = await this.request(`/api/projects/${encodeURIComponent(id)}/events?after=${this.value.snapshot?.project.cursor || 0}`, null, null, AbortSignal.any([signal, attempt.signal]));
        if (!r.body) throw new Error('Live updates are not available.');
        this.value.status = 'live'; this.value.error = null; this.emit(); delay = 300;
        const reader = r.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
        try {
          while (!signal.aborted) {
            const { done, value } = await reader.read(); if (done) break; reset();
            buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
            if (buffer.length > 256 * 1024) throw new Error('A live update exceeded the connection limit.');
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
              const kind = /^event: (.+)$/m.exec(frame)?.[1]; const data = /^data: (.+)$/m.exec(frame)?.[1];
              if (!data || generation !== this.generation) continue;
              const event = JSON.parse(data);
              if (kind === 'revoked') throw Object.assign(new Error('Your access to this project was removed.'), { status: 403 });
              if (kind === 'resync') { await this.refresh(id, generation); throw new Error('Refreshing project history.'); }
              const snapshot = this.value.snapshot;
              if (!snapshot) continue;
              if (kind === 'presence') { snapshot.online = event; this.emit(); }
              if (kind === 'update' && event.cursor > snapshot.project.cursor) {
                if (event.cursor !== snapshot.project.cursor + 1) { await this.refresh(id, generation); continue; }
                if (event.kind === 'task') snapshot.tasks = [event.task, ...snapshot.tasks.filter((t) => t.id !== event.task.id)];
                if (event.kind === 'member') snapshot.members = [...snapshot.members.filter((m) => m.id !== event.member.id), event.member];
                if (event.kind === 'removed') snapshot.members = snapshot.members.filter((m) => m.id !== event.userId);
                snapshot.project.cursor = event.cursor; this.emit();
              }
            }
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        if (!signal.aborted) throw new Error('Live connection interrupted. Reconnecting…');
      } catch (e) {
        if (signal.aborted || generation !== this.generation) return;
        if (e.status === 401 || e.status === 403) { this.value.status = 'disconnected'; this.value.error = e.message; this.value.snapshot = null; this.token = ''; this.emit(); return; }
        this.value.status = 'reconnecting'; this.value.error = e.message; this.emit();
      } finally { clearTimeout(watchdog); attempt.abort(); }
      await new Promise((resolve) => { const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, delay); signal.addEventListener('abort', done, { once: true }); });
      delay = Math.min(delay * 2, 5000);
    }
  }
}
