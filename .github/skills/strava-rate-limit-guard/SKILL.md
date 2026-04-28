---
name: strava-rate-limit-guard
description: "Use when writing Strava fetch/crawling scripts, API loops, or batch sync jobs. Enforce hard caps: overall 200/15min and 2000/day; read 100/15min and 1000/day; apply pacing, backoff, and resume-safe checkpoints."
---

# Strava Rate Limit Guard

Use this skill whenever you add or modify API-fetching logic for Strava data.

## Hard Limits

- Overall limit: 200 requests per 15 minutes, 2000 requests per day.
- Read limit: 100 requests per 15 minutes, 1000 requests per day.
- If request type is unclear, treat it as read and apply the stricter read limits.

## Implementation Rules

1. Keep both window budgets in code: 15-minute window and daily window.
2. Track both categories: overall and read.
3. Before each request, check remaining budget. If exhausted, wait until next window.
4. Parse Strava rate-limit headers on every response and update local counters.
5. Handle HTTP 429 with exponential backoff and jitter.
6. Keep request concurrency low (default 1 to 2 workers).
7. Persist progress checkpoint so retries do not refetch completed pages.
8. Add lightweight logs for `usage/limit`, sleep seconds, and retry count.

## Header-Aware Guard (JavaScript)

```js
// Parse "x,y" headers such as "120,800" -> [120, 800]
function parsePair(raw) {
  if (!raw) return [0, 0];
  const [a, b] = String(raw).split(",").map((v) => Number(v.trim()));
  return [Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0];
}

function computeSleepMs({
  used15,
  lim15,
  usedDay,
  limDay,
  window15StartMs,
  dayStartMs,
  nowMs = Date.now(),
}) {
  const exhausted15 = used15 >= lim15;
  const exhaustedDay = usedDay >= limDay;

  if (!exhausted15 && !exhaustedDay) return 0;

  const wait15 = exhausted15 ? Math.max(0, window15StartMs + 15 * 60_000 - nowMs) : 0;
  const waitDay = exhaustedDay ? Math.max(0, dayStartMs + 24 * 60 * 60_000 - nowMs) : 0;
  return Math.max(wait15, waitDay);
}

async function withRateLimitGuard(doRequest, state) {
  const sleepMs = computeSleepMs(state);
  if (sleepMs > 0) {
    await new Promise((r) => setTimeout(r, sleepMs + 250)); // guard buffer
  }

  try {
    const res = await doRequest();

    const [used15, usedDay] = parsePair(res.headers.get("x-ratelimit-usage"));
    const [lim15, limDay] = parsePair(res.headers.get("x-ratelimit-limit"));
    const [readUsed15, readUsedDay] = parsePair(res.headers.get("x-readratelimit-usage"));
    const [readLim15, readLimDay] = parsePair(res.headers.get("x-readratelimit-limit"));

    state.used15 = Math.max(used15, readUsed15);
    state.lim15 = Math.min(lim15 || 200, readLim15 || 100);
    state.usedDay = Math.max(usedDay, readUsedDay);
    state.limDay = Math.min(limDay || 2000, readLimDay || 1000);

    return res;
  } catch (err) {
    if (err?.status === 429) {
      state.retry = (state.retry || 0) + 1;
      const backoff = Math.min(60_000, 1000 * 2 ** Math.min(state.retry, 6));
      const jitter = Math.floor(Math.random() * 300);
      await new Promise((r) => setTimeout(r, backoff + jitter));
      return withRateLimitGuard(doRequest, state);
    }
    throw err;
  }
}
```

## Pull Request Checklist

- Explicitly mention which endpoints are read vs non-read.
- Show where 15-minute and daily limits are enforced.
- Show 429 handling path and retry cap.
- Confirm checkpoint/resume behavior for long pagination.
