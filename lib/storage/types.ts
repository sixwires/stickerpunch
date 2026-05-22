/**
 * Storage contract shared by both the dev memory stub (Step 6a) and the
 * production Vercel Blob backend (Step 6b). Step 7's collage UI is written
 * against this interface so the two streams can develop in parallel.
 */

export interface Sticker {
  id: string;
  /** Publicly-fetchable URL of the PNG. */
  url: string;
  width: number;
  height: number;
  /** Unix ms timestamp at insert. */
  createdAt: number;
  /** Hidden from public listings (Report path). */
  hidden?: boolean;
}

export interface ListResult {
  items: Sticker[];
  /** Opaque cursor for the next page, or null when exhausted. */
  nextCursor: string | null;
}

export interface PutMeta {
  width: number;
  height: number;
  /**
   * Salted SHA-256 hash of the submitter's IP, in hex. Adapters MAY persist
   * it server-side for rate-limit forensics; it MUST NOT leak to listings.
   */
  ipHashSalted?: string;
}

export interface StorageAdapter {
  /** Persist a PNG blob and return its public metadata. */
  put(blob: Blob, meta: PutMeta): Promise<Sticker>;
  /** List non-hidden stickers newest first. */
  list(cursor?: string | null, limit?: number): Promise<ListResult>;
  /** Mark a sticker as hidden (admin/report). */
  hide(id: string, reason?: string): Promise<void>;
}

export type StorageDriverName = "memory" | "blob";
