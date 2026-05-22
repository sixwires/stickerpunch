/**
 * In-process StorageAdapter for development. Backed by a module-scoped Map
 * to survive Next.js HMR (modules re-evaluate, but we cache on globalThis).
 *
 * Not safe for production: no rate limit, no moderation, lost on restart,
 * single-instance. Step 6b lands the production Vercel Blob backend.
 */

import { nanoid } from "nanoid";

import type { ListResult, PutMeta, Sticker, StorageAdapter } from "./types";

interface MemoryRecord extends Sticker {
  blob: Blob;
  ipHashSalted?: string;
  hideReason?: string;
}

const GLOBAL_KEY = "__stickerpunch_memory_store__";

interface MemoryState {
  records: Map<string, MemoryRecord>;
  order: string[]; // insertion order, newest at the end
  blobUrls: Map<string, string>;
}

function getState(): MemoryState {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: MemoryState };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      records: new Map(),
      order: [],
      blobUrls: new Map(),
    };
  }
  return g[GLOBAL_KEY];
}

export function createMemoryAdapter(): StorageAdapter {
  return {
    async put(blob: Blob, meta: PutMeta): Promise<Sticker> {
      const state = getState();
      const id = nanoid(16);
      const url = blobToUrl(blob, id, state);
      const record: MemoryRecord = {
        id,
        url,
        width: meta.width,
        height: meta.height,
        createdAt: Date.now(),
        blob,
        ipHashSalted: meta.ipHashSalted,
      };
      state.records.set(id, record);
      state.order.push(id);
      return publicView(record);
    },

    async list(cursor: string | null = null, limit = 30): Promise<ListResult> {
      const state = getState();
      // Walk insertion order in reverse (newest first); cursor is the id of
      // the *last* item returned on the prior page.
      const startIdx = cursor
        ? state.order.lastIndexOf(cursor)
        : state.order.length;
      if (cursor && startIdx === -1) {
        return { items: [], nextCursor: null };
      }
      const items: Sticker[] = [];
      let i = startIdx - 1;
      while (i >= 0 && items.length < limit) {
        const rec = state.records.get(state.order[i]);
        i--;
        if (!rec || rec.hidden) continue;
        items.push(publicView(rec));
      }
      const nextCursor =
        items.length === limit && i >= 0 ? items[items.length - 1].id : null;
      return { items, nextCursor };
    },

    async hide(id: string, reason?: string): Promise<void> {
      const state = getState();
      const rec = state.records.get(id);
      if (!rec) return;
      rec.hidden = true;
      rec.hideReason = reason;
    },
  };
}

function publicView(rec: MemoryRecord): Sticker {
  return {
    id: rec.id,
    url: rec.url,
    width: rec.width,
    height: rec.height,
    createdAt: rec.createdAt,
    hidden: rec.hidden,
  };
}

function blobToUrl(blob: Blob, id: string, state: MemoryState): string {
  // In a browser-like runtime, use URL.createObjectURL.
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try {
      const url = URL.createObjectURL(blob);
      state.blobUrls.set(id, url);
      return url;
    } catch {
      // Fall through.
    }
  }
  // Node test runtime: synthesize a deterministic placeholder URL.
  return `memory://stickers/${id}.png`;
}

/** Test helper: reset the in-memory store between cases. */
export function resetMemoryStore(): void {
  const state = getState();
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    for (const url of state.blobUrls.values()) URL.revokeObjectURL(url);
  }
  state.records.clear();
  state.order.length = 0;
  state.blobUrls.clear();
}
