"use server";

import { revalidatePath } from "next/cache";

import { getStorage } from "@/lib/storage";
import type { ListResult, Sticker } from "@/lib/storage/types";

const MAX_BLOB_BYTES = 4 * 1024 * 1024;
const MIN_DIM = 16;
const MAX_DIM = 4096;
const MAX_LIST_LIMIT = 60;

export interface SubmitResult {
  ok: true;
  sticker: Sticker;
}

export interface SubmitError {
  ok: false;
  error: string;
}

export async function submitSticker(formData: FormData): Promise<SubmitResult | SubmitError> {
  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof Blob)) {
    return { ok: false, error: "missing_file" };
  }
  if (fileEntry.type !== "image/png") {
    return { ok: false, error: "invalid_type" };
  }
  if (fileEntry.size === 0 || fileEntry.size > MAX_BLOB_BYTES) {
    return { ok: false, error: "invalid_size" };
  }
  const width = parseDim(formData.get("width"));
  const height = parseDim(formData.get("height"));
  if (!width || !height) {
    return { ok: false, error: "invalid_dimensions" };
  }

  const storage = getStorage();
  const sticker = await storage.put(fileEntry, { width, height });
  revalidatePath("/");
  return { ok: true, sticker };
}

export async function listStickers(
  cursor: string | null = null,
  limit = 30,
): Promise<ListResult> {
  const safeLimit = Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(limit)));
  return getStorage().list(cursor, safeLimit);
}

export async function hideSticker(
  id: string,
  reason?: string,
): Promise<{ ok: true } | SubmitError> {
  if (!id || typeof id !== "string") {
    return { ok: false, error: "invalid_id" };
  }
  await getStorage().hide(id, reason);
  revalidatePath("/");
  return { ok: true };
}

function parseDim(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") return null;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < MIN_DIM || n > MAX_DIM) return null;
  return n;
}
