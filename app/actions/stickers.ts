"use server";

import { revalidatePath } from "next/cache";

import { getModerator } from "@/lib/moderation/server";
import { checkIpLimit } from "@/lib/ratelimit/ip";
import { hashIp, readClientIp } from "@/lib/ratelimit/iphash";
import { getStorage } from "@/lib/storage";
import type { ListResult, Sticker } from "@/lib/storage/types";

const MAX_BLOB_BYTES = 4 * 1024 * 1024;
const MIN_DIM = 16;
const MAX_DIM = 4096;
const MAX_LIST_LIMIT = 60;

export type SubmitError =
  | { ok: false; error: "missing_file" | "invalid_type" | "invalid_size" | "invalid_dimensions" | "invalid_id" }
  | { ok: false; error: "rate_limited"; reset: number }
  | { ok: false; error: "moderation_failed" }
  | { ok: false; error: "service_unavailable" };

export interface SubmitResult {
  ok: true;
  sticker: Sticker;
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

  const ip = await readClientIp();
  const limit = await checkIpLimit(ip);
  if (!limit.ok) {
    if (limit.reason === "config_missing") {
      return { ok: false, error: "service_unavailable" };
    }
    return { ok: false, error: "rate_limited", reset: limit.reset };
  }

  const moderation = await getModerator().check(fileEntry);
  if (!moderation.allowed) {
    return { ok: false, error: "moderation_failed" };
  }

  const ipHashSalted = await hashIp(ip);
  const storage = getStorage();
  const sticker = await storage.put(fileEntry, { width, height, ipHashSalted });
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
): Promise<{ ok: true } | { ok: false; error: "invalid_id" }> {
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
