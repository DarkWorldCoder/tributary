import test from "node:test";
import assert from "node:assert/strict";
import {
  visibleRenderer,
  webglResource,
} from "../ui/src/lib/terminal-renderer.mjs";
class Clock {
  now = 0;
  next = 0;
  tasks = new Map();
  setTimeout(fn, delay) {
    const id = ++this.next;
    this.tasks.set(id, { fn, at: this.now + delay });
    return id;
  }
  clearTimeout(id) {
    this.tasks.delete(id);
  }
  advance(ms) {
    const end = this.now + ms;
    for (;;) {
      const next = [...this.tasks].find(([, t]) => t.at <= end);
      if (!next) break;
      this.tasks.delete(next[0]);
      this.now = next[1].at;
      next[1].fn();
    }
    this.now = end;
  }
}
function fixture(options = {}) {
  const clock = new Clock();
  const resources = [];
  const controller = visibleRenderer({
    clock,
    create(lost) {
      const resource = {
        lost,
        disposed: 0,
        dispose() {
          this.disposed++;
        },
      };
      resources.push(resource);
      return resource;
    },
    ...options,
  });
  return { clock, resources, controller };
}
test("graphics are allocated only while visible; repeated visibility and final disposal are idempotent", () => {
  const { controller: c, resources: r } = fixture();
  assert.equal(r.length, 0);
  c.setVisible(false);
  c.setVisible(true);
  c.setVisible(true);
  assert.equal(r.length, 1);
  assert.equal(c.state().ready, true);
  c.setVisible(false);
  c.setVisible(false);
  assert.equal(r[0].disposed, 1);
  assert.equal(c.state().ready, false);
  c.setVisible(true);
  assert.equal(r.length, 2);
  c.dispose();
  c.dispose();
  c.setVisible(true);
  assert.equal(r.length, 2);
  assert.equal(r[1].disposed, 1);
});
test("context loss disposes immediately and retries at most three times per visible lifetime", () => {
  const { controller: c, resources: r, clock } = fixture();
  c.setVisible(true);
  for (let i = 0; i < 3; i++) {
    r[i].lost();
    r[i].lost();
    assert.equal(r[i].disposed, 1);
    clock.advance(999);
    assert.equal(r.length, i + 1);
    clock.advance(1);
  }
  assert.equal(r.length, 3);
  assert.equal(clock.tasks.size, 0);
  assert.equal(c.state().ready, false);
  c.setVisible(false);
  c.setVisible(true);
  assert.equal(r.length, 4);
  c.dispose();
});
test("hiding or closing cancels retry ownership; stale losses cannot replace a newer renderer", () => {
  for (const close of [false, true]) {
    const { controller: c, resources: r, clock } = fixture();
    c.setVisible(true);
    r[0].lost();
    const queued = [...clock.tasks.values()][0].fn;
    close ? c.dispose() : c.setVisible(false);
    assert.equal(clock.tasks.size, 0);
    clock.advance(5000);
    queued();
    assert.equal(r.length, 1);
    if (!close) {
      c.setVisible(true);
      r[0].lost();
      assert.equal(r[1].disposed, 0);
      assert.equal(clock.tasks.size, 0);
      c.dispose();
    }
  }
});
test("unsupported activation retains the fallback without a retry loop and can retry after showing again", () => {
  let tries = 0;
  const { controller: c, clock } = fixture({
    create() {
      tries++;
      throw Error("WebGL unavailable");
    },
  });
  c.setVisible(true);
  c.setVisible(true);
  clock.advance(10000);
  assert.equal(tries, 1);
  assert.equal(c.state().ready, false);
  assert.equal(clock.tasks.size, 0);
  c.setVisible(false);
  c.setVisible(true);
  assert.equal(tries, 2);
  c.dispose();
});
test("a loss during synchronous activation cannot retain the failed renderer", () => {
  let attempts = 0;
  const disposed = [];
  const { controller: c, clock } = fixture({
    create(lost) {
      const n = ++attempts;
      if (n === 1) lost();
      return {
        dispose() {
          disposed.push(n);
        },
      };
    },
  });
  c.setVisible(true);
  assert.deepEqual(disposed, [1]);
  assert.equal(c.state().ready, false);
  clock.advance(1000);
  assert.equal(c.state().ready, true);
  c.dispose();
  assert.deepEqual(disposed, [1, 2]);
});
test("disposal callbacks cannot recreate resources or leave retry timers after shutdown", () => {
  let lost;
  let disposed = 0;
  const { controller: c, clock } = fixture({
    create(callback) {
      lost = callback;
      return {
        dispose() {
          disposed++;
          callback();
          throw Error("device lost during dispose");
        },
      };
    },
  });
  c.setVisible(true);
  c.dispose();
  lost();
  clock.advance(10000);
  assert.equal(disposed, 1);
  assert.equal(clock.tasks.size, 0);
  assert.equal(c.state().closed, true);
});
function adapter({
  failLoad = false,
  failDispose = false,
  extension = true,
  alreadyLost = false,
} = {}) {
  const order = [];
  const old = {
    getContext() {
      throw Error("must not inspect prior renderer");
    },
  };
  const context = {
    isContextLost: () => alreadyLost,
    getExtension(name) {
      assert.equal(name, "WEBGL_lose_context");
      return extension
        ? {
            loseContext() {
              order.push("lose");
            },
          }
        : null;
    },
  };
  const canvas = {
    getContext(kind) {
      assert.equal(kind, "webgl2");
      return context;
    },
  };
  const twoD = { getContext: () => null };
  const canvases = [old];
  let listener;
  const addon = {
    onContextLoss(callback) {
      listener = callback;
      return {
        dispose() {
          order.push("unsubscribe");
          listener = null;
        },
      };
    },
    dispose() {
      order.push("addon");
      if (failDispose) throw Error("dispose failure");
    },
  };
  const terminal = {
    element: { querySelectorAll: () => canvases },
    loadAddon(value) {
      assert.equal(value, addon);
      order.push("load");
      canvases.push(canvas, twoD);
      if (failLoad) throw Error("activation failed");
    },
  };
  return {
    order,
    terminal,
    addon,
    listener: () => listener,
    lose: () => listener?.(),
  };
}
test("public addon disposal restores fallback before losing only its new WebGL context", () => {
  const f = adapter();
  let lost = 0;
  const resource = webglResource(
    f.terminal,
    () => f.addon,
    () => lost++,
  );
  f.lose();
  assert.equal(lost, 1);
  resource.dispose();
  resource.dispose();
  assert.deepEqual(f.order, ["load", "unsubscribe", "addon", "lose"]);
  assert.equal(f.listener(), null);
});
test("partial activation cleans subscription, addon and context, preserving the original error", () => {
  const f = adapter({ failLoad: true, failDispose: true });
  assert.throws(
    () =>
      webglResource(
        f.terminal,
        () => f.addon,
        () => {},
      ),
    /activation failed/,
  );
  assert.deepEqual(f.order, ["load", "unsubscribe", "addon", "lose"]);
  assert.equal(f.listener(), null);
});
test("context release still runs if addon cleanup throws, and unavailable loss extensions are harmless", () => {
  const f = adapter({ failDispose: true });
  const r = webglResource(
    f.terminal,
    () => f.addon,
    () => {},
  );
  assert.throws(() => r.dispose(), /dispose failure/);
  assert.equal(f.order.at(-1), "lose");
  r.dispose();
  const other = adapter({ extension: false });
  webglResource(
    other.terminal,
    () => other.addon,
    () => {},
  ).dispose();
  assert.deepEqual(other.order, ["load", "unsubscribe", "addon"]);
});
test("eight independent shell owners can retain only the selected renderer, then none while hidden", () => {
  let live = 0;
  let peak = 0;
  const owners = Array.from({ length: 8 }, () =>
    visibleRenderer({
      create() {
        live++;
        peak = Math.max(peak, live);
        return {
          dispose() {
            live--;
          },
        };
      },
    }),
  );
  for (let selected = 0; selected < 8; selected++) {
    owners.forEach((owner) => owner.setVisible(false));
    owners[selected].setVisible(true);
    assert.equal(live, 1);
  }
  owners.forEach((owner) => owner.setVisible(false));
  assert.equal(live, 0);
  assert.equal(peak, 1);
  owners.forEach((owner) => owner.dispose());
});

test("an already queued retry from an older visibility lifetime cannot retry a new failed activation", () => {
  let created = 0;
  let lost;
  const { controller: c, clock } = fixture({
    create(callback) {
      created++;
      lost = callback;
      if (created > 1) throw Error("unavailable now");
      return { dispose() {} };
    },
  });
  c.setVisible(true);
  lost();
  const queued = [...clock.tasks.values()][0].fn;
  c.setVisible(false);
  c.setVisible(true);
  assert.equal(created, 2);
  queued();
  assert.equal(created, 2);
  c.dispose();
});

test("already-lost contexts are not lost twice, avoiding INVALID_OPERATION", () => {
  const f = adapter({ alreadyLost: true });
  webglResource(f.terminal, () => f.addon, () => {}).dispose();
  assert.deepEqual(f.order, ["load", "unsubscribe", "addon"]);
});
