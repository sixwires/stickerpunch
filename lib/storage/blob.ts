/**
 * Vercel Blob storage adapter. Production backend for Step 6b.
 *
 * Public keys are random nanoids (NOT content hashes) so URLs are
 * unguessable; dedup, if enabled, runs through a private hash -> id index
 * provided separately.
 *
 * Metadata sidecar: `meta/<inv-ts>-<id>.json` where inv-ts is a 16-digit
 * lexicographically-descending timestamp. Lists by prefix yield newest-
 * first naturally without a separate sort.
 */

import {
  del,
  head,
  list as blobList,
  put as blobPut,
  type ListBlobResult,
} from "@vercel/blob";
import { nanoid } from "nanoid";

import {
  createMemoryDedupIndex,
  hashBlobContent,
  type DedupIndex,
} from "./dedupIndex";
import type { ListResult, PutMeta, Sticker, StorageAdapter } from "./types";

const STICKER_PREFIX = "stickers/";
const META_PREFIX = "meta/";
const TIMESTAMP_DIGITS = 16;

interface SidecarRecord {
  id: string;
  blobUrl: string;
  width: number;
  height: number;
  createdAt: number;
  hidden?: boolean;
  hideReason?: string;
  ipHashSalted?: string;
  contentHash?: string;
}

export interface BlobAdapterOptions {
  dedup?: DedupIndex;
}

export function createBlobAdapter(options: BlobAdapterOptions = {}): StorageAdapter {
  const dedup = options.dedup ?? createMemoryDedupIndex();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN not configured");
  }

  return {
    async put(blob: Blob, meta: PutMeta): Promise<Sticker> {
      const contentHash = await hashBlobContent(blob);
      const existingId = await dedup.get(contentHash);
      if (existingId) {
        const sidecar = await readSidecarById(existingId, token);
        if (sidecar && !sidecar.hidden) {
          return publicView(sidecar);
        }
      }

      const id = nanoid(16);
      const stickerKey = `${STICKER_PREFIX}${id}.png`;
      const stickerBlob = await blobPut(stickerKey, blob, {
        access: "public",
        contentType: "image/png",
        addRandomSuffix: false,
        token,
      });

      const createdAt = Date.now();
      const sidecar: SidecarRecord = {
        id,
        blobUrl: stickerBlob.url,
        width: meta.width,
        height: meta.height,
        createdAt,
        ipHashSalted: meta.ipHashSalted,
        contentHash,
      };
      await writeSidecar(sidecar, token);
      await dedup.set(contentHash, id);

      return publicView(sidecar);
    },

    async list(cursor: string | null = null, limit = 30): Promise<ListResult> {
      const items: Sticker[] = [];
      let nextCursor: string | null = cursor;
      // We may need to fetch multiple pages from Blob to skip hidden items.
      // Cap the loop iterations so a flood of hidden items can't hang the call.
      for (let i = 0; i < 5 && items.length < limit; i++) {
        const page: ListBlobResult = await blobList({
          prefix: META_PREFIX,
          limit: Math.max(limit * 2, 60),
          cursor: nextCursor ?? undefined,
          token,
        });
        for (const entry of page.blobs) {
          if (items.length >= limit) break;
          const sidecar = await fetchSidecar(entry.url);
          if (!sidecar || sidecar.hidden) continue;
          items.push(publicView(sidecar));
        }
        nextCursor = page.hasMore ? page.cursor ?? null : null;
        if (!nextCursor) break;
      }
      return { items, nextCursor };
    },

    async hide(id: string, reason?: string): Promise<void> {
      const sidecar = await readSidecarById(id, token);
      if (!sidecar) return;
      sidecar.hidden = true;
      sidecar.hideReason = reason;
      await writeSidecar(sidecar, token);
    },
  };
}

function publicView(rec: SidecarRecord): Sticker {
  return {
    id: rec.id,
    url: rec.blobUrl,
    width: rec.width,
    height: rec.height,
    createdAt: rec.createdAt,
    hidden: rec.hidden,
  };
}

function sidecarKey(rec: SidecarRecord): string {
  const inv = (Number.MAX_SAFE_INTEGER - rec.createdAt)
    .toString()
    .padStart(TIMESTAMP_DIGITS, "0");
  return `${META_PREFIX}${inv}-${rec.id}.json`;
}

async function writeSidecar(rec: SidecarRecord, token: string): Promise<void> {
  const key = sidecarKey(rec);
  const body = JSON.stringify(rec);
  await blobPut(key, body, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    token,
  });
}

async function fetchSidecar(url: string): Promise<SidecarRecord | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as SidecarRecord;
  } catch {
    return null;
  }
}

async function readSidecarById(id: string, token: string): Promise<SidecarRecord | null> {
  // We don't know the timestamp prefix, so list with the id suffix.
  const page: ListBlobResult = await blobList({
    prefix: META_PREFIX,
    limit: 100,
    token,
  });
  const match = page.blobs.find((b) => b.pathname.endsWith(`-${id}.json`));
  if (!match) return null;
  return fetchSidecar(match.url);
}

/** Test helper: surface internals for unit tests. */
export const __blobInternals = {
  sidecarKey,
  publicView,
};

/** Allow the dispatcher to clear/delete a sticker's underlying blob. */
export async function deleteSticker(id: string): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  const sidecar = await readSidecarById(id, token);
  if (!sidecar) return;
  await del(sidecar.blobUrl, { token });
  await del(sidecarKey(sidecar), { token });
}

/** Diagnostic: estimate Blob bytes used. Cron in Step 8 calls this. */
export async function approximateBlobUsage(): Promise<{ bytes: number; count: number }> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { bytes: 0, count: 0 };
  let cursor: string | undefined = undefined;
  let bytes = 0;
  let count = 0;
  for (let i = 0; i < 10; i++) {
    const page: ListBlobResult = await blobList({ limit: 1000, cursor, token });
    for (const entry of page.blobs) {
      bytes += entry.size;
      count++;
    }
    if (!page.hasMore) break;
    cursor = page.cursor ?? undefined;
  }
  return { bytes, count };
}

void head; // mark as used (kept for potential future single-blob inspection)
