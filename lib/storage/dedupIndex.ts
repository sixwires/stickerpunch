/**
 * Optional dedup map keyed on content hash so users uploading the same
 * sticker twice land on the same id. Decoupled from the public URL on
 * purpose: public IDs stay random (enumeration defense) while the hash
 * lookup is private.
 *
 * Default impl is in-memory (single instance, lost on restart). For a
 * persistent backend, swap in a Vercel KV-equivalent (e.g. Upstash Redis)
 * by implementing the same interface.
 */

export interface DedupIndex {
  /** Lookup a previously seen content hash. */
  get(hash: string): Promise<string | null>;
  /** Record a hash -> id mapping. */
  set(hash: string, id: string): Promise<void>;
}

export function createMemoryDedupIndex(): DedupIndex {
  const map = new Map<string, string>();
  return {
    async get(hash) {
      return map.get(hash) ?? null;
    },
    async set(hash, id) {
      map.set(hash, id);
    },
  };
}

export async function hashBlobContent(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}
