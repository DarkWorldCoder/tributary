// ACK only the contiguous prefix parsed by xterm. Coalescing avoids an IPC call
// per native read; callbacks from a disposed renderer cannot release output.
export function terminalConsumer({ owner, write, acknowledge }, { delay = 8 } = {}) {
  let disposed = false; let received = 0; let committed = 0; let timer = null; let records = []; let head = 0; let queued = 0;
  const flush = () => { if (timer != null) clearTimeout(timer); timer = null; if (!disposed && committed) { const seq = committed; committed = 0; acknowledge(owner, seq); } };
  const receive = (packet) => {
    if (disposed || packet.owner !== owner || !Number.isSafeInteger(packet.seq) || packet.seq <= received || typeof packet.data !== 'string') return;
    received = packet.seq; const record = { seq: packet.seq, length: packet.data.length, done: false }; records.push(record); queued += record.length;
    write(packet.data, () => {
      if (disposed || record.done) return; record.done = true;
      while (head < records.length && records[head].done) { const current = records[head]; committed = current.seq; queued -= current.length; records[head++] = null; }
      if (head === records.length) { records = []; head = 0; }
      else if (head >= 64) { records = records.slice(head); head = 0; }
      if (committed && timer == null) timer = setTimeout(flush, delay);
    });
  };
  return { receive, flush,
    dispose() { disposed = true; if (timer != null) clearTimeout(timer); timer = null; records = []; head = committed = queued = 0; },
    stats: () => ({ queued, callbacks: records.length - head, timer: timer != null, disposed }),
  };
}
