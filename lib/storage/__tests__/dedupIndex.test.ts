import { describe, expect, it } from "vitest";

import { createMemoryDedupIndex, hashBlobContent } from "../dedupIndex";

describe("hashBlobContent", () => {
  it("produces a stable 64-char hex for the same bytes", async () => {
    const blob = new Blob(["hello world"]);
    const a = await hashBlobContent(blob);
    const b = await hashBlobContent(new Blob(["hello world"]));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs across different bytes", async () => {
    const a = await hashBlobContent(new Blob(["alpha"]));
    const b = await hashBlobContent(new Blob(["beta"]));
    expect(a).not.toBe(b);
  });
});

describe("createMemoryDedupIndex", () => {
  it("round-trips set + get", async () => {
    const idx = createMemoryDedupIndex();
    expect(await idx.get("nope")).toBeNull();
    await idx.set("hashA", "id1");
    expect(await idx.get("hashA")).toBe("id1");
  });
});
