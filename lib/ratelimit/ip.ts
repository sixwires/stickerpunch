/**
 * Per-IP rate limiting backed by Upstash Redis sliding window.
 * Mandatory in production: when NODE_ENV=production and the Upstash env
 * is missing, callers MUST treat the limiter as failed-closed (reject).
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Unix ms when the limit resets. */
  reset: number;
  /** Why this attempt was rejected, if any. */
  reason?: "rate_limited" | "config_missing";
}

export interface RateLimiter {
  check(ip: string): Promise<RateLimitResult>;
}

const DEFAULT_LIMIT = 30;
const DEFAULT_WINDOW = "1 h" as const;

interface UpstashEnv {
  url: string;
  token: string;
}

let cachedLimiter: Ratelimit | null = null;

function readEnv(): UpstashEnv | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

function getLimiter(): Ratelimit | null {
  if (cachedLimiter) return cachedLimiter;
  const env = readEnv();
  if (!env) return null;
  const redis = new Redis({ url: env.url, token: env.token });
  cachedLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(DEFAULT_LIMIT, DEFAULT_WINDOW),
    analytics: false,
    prefix: "stickerpunch:rl:ip",
  });
  return cachedLimiter;
}

/**
 * Check the configured limiter. In dev (NODE_ENV !== "production") with no
 * Upstash env, returns `ok: true` so local testing isn't blocked. In prod
 * with no env, returns `ok: false, reason: "config_missing"` — caller should
 * surface a 503.
 */
export async function checkIpLimit(ip: string): Promise<RateLimitResult> {
  const limiter = getLimiter();
  if (!limiter) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, remaining: 0, reset: 0, reason: "config_missing" };
    }
    return { ok: true, remaining: DEFAULT_LIMIT, reset: 0 };
  }
  const result = await limiter.limit(ip);
  return {
    ok: result.success,
    remaining: result.remaining,
    reset: result.reset,
    reason: result.success ? undefined : "rate_limited",
  };
}

/** Test helper. */
export function __resetLimiterCacheForTests(): void {
  cachedLimiter = null;
}
