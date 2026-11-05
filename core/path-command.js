'use strict';
const { createPathPrefix } = require('./path-prefix');
const ignore = () => {};
// Failures settle promptly. Existing host.kill owns eventual process-tree/SSH
// cleanup; the remaining pipes drain without retaining command output.
function drainUntilClose(child) {
  const streams = [child.stdout, child.stderr].filter(Boolean);
  child.on('error', ignore); for (const stream of streams) { stream.on('error', ignore); stream.resume(); }
  child.once('close', () => { child.off('error', ignore); for (const stream of streams) stream.off('error', ignore); });
}
function readPathCommand(host, command, args, { cwd, limit, timeout = 8000, maxBytes = 200000000, stripDot = false } = {}) {
  return new Promise(resolve => {
    let child, timer, done = false, closed = false, stdoutBytes = 0, stderrBytes = 0;
    let prefix = createPathPrefix(limit, { maxRecordBytes: maxBytes, stripDot });
    const finish = (ok, code, failure = '') => {
      if (done) return; done = true; clearTimeout(timer);
      const files = prefix.finish({ partial: ok }); prefix.dispose(); prefix = null;
      if (child) {
        child.stdout.off('data', stdout); child.stderr.off('data', stderr);
        child.stdout.off('error', streamError); child.stderr.off('error', streamError);
        child.off('error', processError); child.off('close', close);
        if (!closed) drainUntilClose(child);
      }
      resolve({ ok, code, failure, files, stdoutBytes, stderrBytes });
    };
    const fail = reason => { if (done) return; finish(false, null, reason); try { host.kill(child); } catch { /* result already failed; host owns termination */ } };
    const stdout = data => {
      if (done) return;
      stdoutBytes += data.length;
      if (stdoutBytes > maxBytes) { fail('stdout output limit exceeded'); return; }
      try { prefix.write(data); } catch (error) { fail(error.message); }
    };
    const stderr = data => { if (done) return; stderrBytes += data.length; if (stderrBytes > maxBytes) fail('stderr output limit exceeded'); };
    const streamError = () => fail('Command pipe failed');
    const processError = () => fail('Command could not start');
    const close = code => { closed = true; finish(code === 0, code, code === 0 ? '' : 'Command failed'); };
    try {
      child = host.spawn(command, args, { cwd });
      child.stdout.on('data', stdout); child.stderr.on('data', stderr);
      child.stdout.on('error', streamError); child.stderr.on('error', streamError);
      child.once('error', processError); child.once('close', close);
      if (timeout) timer = setTimeout(() => fail('Command timed out'), timeout);
    } catch { fail('Command could not start'); }
  });
}
module.exports = { readPathCommand };
