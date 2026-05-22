/**
 * Storage adapter dispatcher. Defaults to the in-memory stub for local dev.
 * Step 6b adds the "blob" driver; this file fails fast in production when
 * required env is missing.
 */

import { createBlobAdapter } from "./blob";
import { createMemoryAdapter } from "./memory";
import type { StorageAdapter, StorageDriverName } from "./types";

let cached: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (cached) return cached;

  const driver = (process.env.STORAGE_DRIVER ?? "memory") as StorageDriverName;
  if (driver === "memory") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "STORAGE_DRIVER=memory is not allowed in production. Set STORAGE_DRIVER=blob.",
      );
    }
    cached = createMemoryAdapter();
    return cached;
  }

  if (driver === "blob") {
    cached = createBlobAdapter();
    return cached;
  }

  throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
}

/** Test/server-action helper: drop the cached adapter so env changes take effect. */
export function resetStorageCache(): void {
  cached = null;
}

export type { ListResult, PutMeta, Sticker, StorageAdapter } from "./types";
