"""Exercise the gateway against a fake Telegram server.

    python3 test_gateway.py            # limiter on
    python3 test_gateway.py --no-limit # limiter off: watch the server flood you
    python3 test_gateway.py --ui       # show a FloodWait reaching the caller
    python3 test_gateway.py --giveup   # retry cap, deadline, and huge-wait cutoff
"""
import argparse, asyncio, random, time
from collections import deque
from gateway import ApiError, FailPolicy, FloodWait, Gateway, TooManyRetries, TransientError


class FakeServer:
    """Allows `limit` requests per `window` seconds per chat, else FLOOD_WAIT."""

    def __init__(self, limit=5, window=2.0, wait=3, transient_rate=0.1):
        self.limit, self.window, self.wait = limit, window, wait
        self.transient_rate = transient_rate
        self.hits = {}
        self.floods = 0
        self.transients = 0
        self.delivered = []

    async def __call__(self, req):
        await asyncio.sleep(0.02)  # network latency
        if random.random() < self.transient_rate:
            self.transients += 1
            raise TransientError("socket reset")
        q = self.hits.setdefault(req.chat, deque())
        now = time.monotonic()
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            self.floods += 1
            raise ApiError(420, f"FLOOD_WAIT_{self.wait}")
        q.append(now)
        self.delivered.append(req.text)
        return {"ok": True, "text": req.text}


class SendMessage:
    def __init__(self, chat, text):
        self.chat, self.text = chat, text


async def burst(enabled):
    random.seed(1)
    server = FakeServer()
    # server allows 5 per 2s sliding window; burst 1 + 2.0/s never exceeds 5 in any 2s
    gw = Gateway(server, limits={"global": (50, 50), "chat:1": (2.0, 1)}, enabled=enabled)
    t0 = time.monotonic()
    results = await asyncio.gather(
        *(gw.send(SendMessage(1, f"msg {i}"), key="chat:1") for i in range(20))
    )
    took = time.monotonic() - t0
    gw.close()
    print(f"limiter {'ON ' if enabled else 'OFF'}: {len(results)} ok in {took:5.1f}s | "
          f"wire sends {gw.stats['sent']:3d} | server floods {server.floods:2d} | "
          f"flood retries {gw.stats['flood_retries']:2d} | transient retries {gw.stats['transient_retries']}")
    assert all(r["ok"] for r in results)
    assert sorted(server.delivered) == sorted(f"msg {i}" for i in range(20)), "lost or duplicated message"


async def ui_policy():
    server = FakeServer(limit=1, window=5.0, wait=4, transient_rate=0)
    gw = Gateway(server, limits={"global": (50, 50)}, enabled=False)
    await gw.send(SendMessage(9, "first"), key="chat:9")
    try:
        await gw.send(SendMessage(9, "second"), key="chat:9", policy=FailPolicy.HANDLE_FLOOD)
    except FloodWait as e:
        print(f"HANDLE_FLOOD: caller got FloodWait({e.seconds}s) -> show 'try again later'")
    gw.close()


class AlwaysFlood:
    """Server that floods every request, escalating the wait like Telegram does."""

    def __init__(self, waits):
        self.waits, self.calls = list(waits), 0

    async def __call__(self, req):
        self.calls += 1
        w = self.waits[min(self.calls, len(self.waits)) - 1]
        raise ApiError(420, f"FLOOD_WAIT_{w}")


class AlwaysDrop:
    def __init__(self):
        self.calls = 0

    async def __call__(self, req):
        self.calls += 1
        raise TransientError("socket reset")


async def give_up():
    # 1. retry cap: 3 retries -> 4 attempts total, then TooManyRetries
    srv = AlwaysDrop()
    gw = Gateway(srv, limits={"global": (50, 50)}, max_retries=3)
    try:
        await gw.send(SendMessage(1, "x"))
    except TooManyRetries as e:
        print(f"retry cap : gave up after {e.attempts} attempts ({srv.calls} wire calls), last={e.last!r}")
    gw.close()

    # 2. deadline: 1s budget, server says wait 1s each time -> fails before 2nd wait
    srv = AlwaysFlood([1, 1, 1])
    gw = Gateway(srv, limits={"global": (50, 50)}, max_retries=10)
    t0 = time.monotonic()
    try:
        await gw.send(SendMessage(1, "x"), timeout=1.5)
    except TooManyRetries as e:
        print(f"deadline  : gave up after {e.attempts} attempts in {time.monotonic()-t0:.1f}s, last={e.last!r}")
    gw.close()

    # 3. huge wait: server answers FLOOD_WAIT_3600 -> fail at once, not after an hour
    srv = AlwaysFlood([3600])
    gw = Gateway(srv, limits={"global": (50, 50)}, max_wait=300)
    t0 = time.monotonic()
    try:
        await gw.send(SendMessage(1, "x"))
    except TooManyRetries as e:
        print(f"huge wait : failed in {time.monotonic()-t0:.2f}s, last={e.last!r}")
    gw.close()


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--no-limit", action="store_true", help="disable the proactive bucket")
    p.add_argument("--ui", action="store_true", help="demo the HANDLE_FLOOD policy")
    p.add_argument("--giveup", action="store_true", help="demo retry cap and deadline")
    a = p.parse_args()
    if a.ui:
        await ui_policy()
        return
    if a.giveup:
        await give_up()
        return
    await burst(enabled=not a.no_limit)


if __name__ == "__main__":
    asyncio.run(main())
