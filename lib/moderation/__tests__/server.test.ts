import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetModeratorCacheForTests,
  failClosedModerator,
  getModerator,
  httpModerator,
  noopModerator,
} from "../server";

const originalEnv = { ...process.env };

describe("Moderator implementations", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    __resetModeratorCacheForTests();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    __resetModeratorCacheForTests();
    vi.restoreAllMocks();
  });

  it("noopModerator always allows", async () => {
    const m = noopModerator();
    const r = await m.check(new Blob(["x"]));
    expect(r.allowed).toBe(true);
  });

  it("failClosedModerator always rejects with config_missing", async () => {
    const m = failClosedModerator();
    const r = await m.check(new Blob(["x"]));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("config_missing");
  });

  it("httpModerator returns allowed=false when endpoint flags content", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ flagged: true, score: 0.92 }), { status: 200 }),
      );
    const m = httpModerator("https://example.com/check", "secret");
    const r = await m.check(new Blob(["x"], { type: "image/png" }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("nsfw");
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    expect((call[1] as RequestInit)?.method).toBe("POST");
    expect((call[1] as RequestInit & { headers: Record<string, string> })?.headers?.authorization).toBe(
      "Bearer secret",
    );
  });

  it("httpModerator fails closed on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    const m = httpModerator("https://example.com/check");
    const r = await m.check(new Blob(["x"]));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("endpoint_error");
  });

  it("getModerator uses fail-closed in production without MODERATION_ENDPOINT", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.MODERATION_ENDPOINT;
    const m = getModerator();
    const r = await m.check(new Blob(["x"]));
    expect(r.allowed).toBe(false);
  });

  it("getModerator uses noop in development without MODERATION_ENDPOINT", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.MODERATION_ENDPOINT;
    const m = getModerator();
    const r = await m.check(new Blob(["x"]));
    expect(r.allowed).toBe(true);
  });
});
