import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Weekly cron stub: emits the rotation request that operators must apply.
 *
 * Programmatic Vercel env-var rotation requires the platform API; for now
 * this endpoint signals "rotate the salt" so external tooling (or a manual
 * runbook) can run `vercel env rm RATELIMIT_SALT && vercel env add` cleanly.
 * The signal is also logged so it's visible in cron observability.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!cronSecret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  console.warn(
    "[stickerpunch] RATELIMIT_SALT rotation due — operator: replace the env var.",
  );
  return NextResponse.json({
    ok: true,
    rotateAt: new Date().toISOString(),
    message: "Rotate RATELIMIT_SALT via Vercel env management.",
  });
}
