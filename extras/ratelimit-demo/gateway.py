"""Client-side request gateway modelled on tdesktop's MTProto instance.

- proactive: token bucket per key (set enabled=False to turn it off)
- reactive: parse FLOOD_WAIT_N / SLOWMODE_WAIT_N, park the request, retry later
- per-request FailPolicy decides whether the caller sees the wait
"""
import asyncio, heapq, re, time
from dataclasses import dataclass, field
from enum import Enum


class FailPolicy(Enum):
    SIMPLE = 1        # swallow flood/transient, retry silently
    HANDLE_FLOOD = 2  # surface flood waits, still retry transient
    HANDLE_ALL = 3    # surface everything


class ApiError(Exception):
    def __init__(self, code, type_):
        super().__init__(f"{code} {type_}")
        self.code, self.type = code, type_


class FloodWait(Exception):
    def __init__(self, seconds):
        super().__init__(f"flood wait {seconds}s")
        self.seconds = seconds


class TransientError(Exception):
    pass


class TooManyRetries(Exception):
    """Raised when a request exhausts max_retries or passes its deadline."""

    def __init__(self, attempts, last):
        super().__init__(f"gave up after {attempts} attempts: {last!r}")
        self.attempts, self.last = attempts, last


WAIT_RE = re.compile(r"^(FLOOD_WAIT|FLOOD_PREMIUM_WAIT|SLOWMODE_WAIT)_(\d+)$")


class TokenBucket:
    def __init__(self, rate, burst):
        self.rate, self.burst = rate, burst
        self.tokens, self.last, self.blocked_until = burst, time.monotonic(), 0.0

    def delay(self):
        now = time.monotonic()
        if now < self.blocked_until:
            return self.blocked_until - now
        self.tokens = min(self.burst, self.tokens + (now - self.last) * self.rate)
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return 0.0
        return (1 - self.tokens) / self.rate

    def block(self, seconds):
        self.blocked_until = max(self.blocked_until, time.monotonic() + seconds)


@dataclass(order=True)
class Pending:
    send_at: float
    seq: int
    req: object = field(compare=False)


class Gateway:
    def __init__(self, transport, limits, enabled=True, max_queue=10_000,
                 max_retries=5, max_wait=300.0, default_timeout=120.0):
        self.transport = transport
        self.max_retries = max_retries        # attempts after the first
        self.max_wait = max_wait              # a FLOOD_WAIT longer than this is a hard fail
        self.default_timeout = default_timeout
        self.buckets = {k: TokenBucket(*v) for k, v in limits.items()}
        self.enabled = enabled
        self.max_queue = max_queue
        self.queue = []
        self.backoff = {}
        self.seq = 0
        self.wake = asyncio.Event()
        self.stats = {"sent": 0, "flood_retries": 0, "transient_retries": 0, "gave_up": 0}
        self._task = asyncio.create_task(self._loop())

    async def send(self, req, key="global", policy=FailPolicy.SIMPLE,
                   timeout=None, max_retries=None):
        if len(self.queue) >= self.max_queue:
            raise RuntimeError("request queue full")
        req.key, req.policy = key, policy
        req.attempts = 0
        req.max_retries = self.max_retries if max_retries is None else max_retries
        req.deadline = time.monotonic() + (self.default_timeout if timeout is None else timeout)
        req.future = asyncio.get_running_loop().create_future()
        self._schedule(req, time.monotonic())
        return await req.future

    def close(self):
        self._task.cancel()

    def _bucket(self, key):
        if key not in self.buckets:
            self.buckets[key] = TokenBucket(1, 1)  # conservative default for unknown keys
        return self.buckets[key]

    def _schedule(self, req, when):
        self.seq += 1
        heapq.heappush(self.queue, Pending(when, self.seq, req))
        self.wake.set()

    async def _loop(self):
        while True:
            if not self.queue:
                self.wake.clear()
                await self.wake.wait()
                continue
            head = self.queue[0]
            wait = head.send_at - time.monotonic()
            if wait > 0:
                self.wake.clear()
                try:
                    await asyncio.wait_for(self.wake.wait(), wait)
                except asyncio.TimeoutError:
                    pass
                continue
            item = heapq.heappop(self.queue)
            if self.enabled:
                d = self._bucket(item.req.key).delay()
                if d > 0:
                    self._schedule(item.req, time.monotonic() + d)
                    continue
            asyncio.create_task(self._fire(item.req))

    async def _fire(self, req):
        if time.monotonic() > req.deadline:
            self._give_up(req, TimeoutError("deadline passed before send"))
            return
        self.stats["sent"] += 1
        req.attempts += 1
        try:
            result = await self.transport(req)
        except Exception as e:  # noqa: BLE001
            self._on_error(req, e)
            return
        self.backoff.pop(id(req), None)
        req.future.set_result(result)

    def _give_up(self, req, err):
        self.backoff.pop(id(req), None)
        self.stats["gave_up"] += 1
        req.future.set_exception(TooManyRetries(req.attempts, err))

    def _retry(self, req, delay, err):
        """Reschedule unless the retry budget or deadline is exhausted."""
        if req.attempts > req.max_retries:
            self._give_up(req, err)
            return
        if time.monotonic() + delay > req.deadline:
            self._give_up(req, err)
            return
        self._schedule(req, time.monotonic() + delay)

    def _on_error(self, req, err):
        m = WAIT_RE.match(getattr(err, "type", "") or "")
        if m:
            secs = int(m.group(2))
            self._bucket(req.key).block(min(secs, self.max_wait))
            if req.policy in (FailPolicy.HANDLE_FLOOD, FailPolicy.HANDLE_ALL):
                req.future.set_exception(FloodWait(secs))
                return
            if secs > self.max_wait:
                self._give_up(req, FloodWait(secs))   # do not sit on a 1h wait silently
                return
            self.stats["flood_retries"] += 1
            self._retry(req, secs + 0.01, err)
            return
        if isinstance(err, TransientError):
            if req.policy is FailPolicy.HANDLE_ALL:
                req.future.set_exception(err)
                return
            secs = self.backoff.get(id(req), 0.25)
            self.backoff[id(req)] = secs if secs > 60 else secs * 2
            self.stats["transient_retries"] += 1
            self._retry(req, secs, err)
            return
        req.future.set_exception(err)
