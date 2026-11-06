/** Small fetch wrapper: timeout, retries with exponential backoff, and a polite delay. */

export const USER_AGENT = 'appintel/0.1 (+chart research; contact via repository)';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(public status: number, public url: string, body: string) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 200)}`);
  }
}

export async function fetchJson<T>(
  url: string,
  opts: { retries?: number; timeoutMs?: number; init?: RequestInit } = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
    try {
      const res = await fetch(url, {
        ...opts.init,
        signal: ctrl.signal,
        headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...(opts.init?.headers ?? {}) },
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new HttpError(res.status, url, text);
        // 4xx other than 429 will not get better with retries.
        if (res.status !== 429 && res.status < 500) throw err;
        lastErr = err;
      } else {
        return JSON.parse(text) as T;
      }
    } catch (e) {
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(2000 * 2 ** attempt); // 2s, 4s, 8s, 16s
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Serialises calls so that at most one request starts every `intervalMs`. */
export class RateLimiter {
  private next = 0;
  constructor(private intervalMs: number) {}
  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.intervalMs;
    if (at > now) await sleep(at - now);
  }
}
