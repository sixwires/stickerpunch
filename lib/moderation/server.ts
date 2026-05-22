/**
 * Server-side NSFW gate. Authoritative — Step 8's client-side check is a UX
 * courtesy only. Must run before any Blob write.
 *
 * Two implementations:
 *   - `httpModerator(url, apiKey)`: POSTs the blob to a configured endpoint
 *     and expects `{ flagged: boolean, score?: number }`. Any HTTP error
 *     is treated as flagged (fail closed).
 *   - `noopModerator()`: allows everything. Used in dev/test only.
 *
 * Production loads `httpModerator` from MODERATION_ENDPOINT (+ optional
 * MODERATION_API_KEY). When prod is configured without the endpoint, the
 * dispatcher returns a fail-closed noop that rejects every submission.
 */

export interface ModerationResult {
  allowed: boolean;
  score?: number;
  reason?: "nsfw" | "endpoint_error" | "config_missing";
}

export interface Moderator {
  check(blob: Blob): Promise<ModerationResult>;
}

let cached: Moderator | null = null;

export function getModerator(): Moderator {
  if (cached) return cached;
  const endpoint = process.env.MODERATION_ENDPOINT;
  if (endpoint) {
    cached = httpModerator(endpoint, process.env.MODERATION_API_KEY);
    return cached;
  }
  if (process.env.NODE_ENV === "production") {
    cached = failClosedModerator();
    return cached;
  }
  cached = noopModerator();
  return cached;
}

export function noopModerator(): Moderator {
  return {
    async check() {
      return { allowed: true };
    },
  };
}

export function failClosedModerator(): Moderator {
  return {
    async check() {
      return { allowed: false, reason: "config_missing" };
    },
  };
}

export function httpModerator(endpoint: string, apiKey?: string): Moderator {
  return {
    async check(blob: Blob) {
      try {
        const headers: Record<string, string> = { "content-type": blob.type || "image/png" };
        if (apiKey) headers.authorization = `Bearer ${apiKey}`;
        const res = await fetch(endpoint, {
          method: "POST",
          body: blob,
          headers,
        });
        if (!res.ok) {
          return { allowed: false, reason: "endpoint_error" };
        }
        const json = (await res.json()) as { flagged?: boolean; score?: number };
        return {
          allowed: !json.flagged,
          score: json.score,
          reason: json.flagged ? "nsfw" : undefined,
        };
      } catch {
        return { allowed: false, reason: "endpoint_error" };
      }
    },
  };
}

/** Test helper. */
export function __resetModeratorCacheForTests(): void {
  cached = null;
}
