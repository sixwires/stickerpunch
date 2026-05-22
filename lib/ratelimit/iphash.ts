/**
 * Salted SHA-256 hash of a client IP for non-reversible bucket tracking.
 * Uses the Web Crypto API (available in Node 20+ and the Vercel runtime).
 *
 * The salt must be rotated periodically (cron in Step 8) so prior buckets
 * naturally fade and no long-term cross-session identification is possible.
 */

import { headers } from "next/headers";

const FALLBACK_IP = "0.0.0.0";

export async function hashIp(ip: string): Promise<string> {
  const salt = process.env.RATELIMIT_SALT ?? "";
  if (process.env.NODE_ENV === "production" && !salt) {
    throw new Error("RATELIMIT_SALT not configured in production");
  }
  const data = new TextEncoder().encode(`${salt}|${ip}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/** Best-effort client IP from incoming request headers. */
export async function readClientIp(): Promise<string> {
  const h = await headers();
  // x-forwarded-for can be a comma-separated list; the leftmost is the
  // claimed origin client, but on Vercel only the rightmost is trustworthy.
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return h.get("x-real-ip") ?? FALLBACK_IP;
}
