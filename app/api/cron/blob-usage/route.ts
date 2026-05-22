import { NextResponse } from "next/server";

import { approximateBlobUsage } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FREE_TIER_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
const WARN_RATIO = 0.8;

/**
 * Daily Vercel cron: tally Blob bytes used and alert if approaching the
 * free-tier ceiling. Returns a JSON payload so the alert can be hooked
 * into a downstream notifier (Slack webhook, email, etc.) via the
 * platform's cron observability.
 */
export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const usage = await approximateBlobUsage();
  const ratio = usage.bytes / FREE_TIER_BYTES;
  const warn = ratio >= WARN_RATIO;
  if (warn) {
    console.warn(
      `[stickerpunch] Blob usage at ${(ratio * 100).toFixed(1)}% of free tier (${usage.bytes} bytes, ${usage.count} blobs)`,
    );
  }
  return NextResponse.json({
    ok: true,
    bytes: usage.bytes,
    count: usage.count,
    ratio,
    warn,
  });
}

function isAuthorizedCron(req: Request): boolean {
  // Vercel cron requests carry `Authorization: Bearer <CRON_SECRET>`.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${cronSecret}`;
}
