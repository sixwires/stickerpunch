import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryAdapter, resetMemoryStore } from "../memory";

function makeBlob(): Blob {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
}

describe("createMemoryAdapter", () => {
  beforeEach(() => {
    resetMemoryStore();
  });

  it("put returns a sticker with non-empty id and url", async () => {
    const adapter = createMemoryAdapter();
    const sticker = await adapter.put(makeBlob(), { width: 100, height: 80 });
    expect(sticker.id.length).toBeGreaterThan(8);
    expect(sticker.url.length).toBeGreaterThan(0);
    expect(sticker.width).toBe(100);
    expect(sticker.height).toBe(80);
    expect(typeof sticker.createdAt).toBe("number");
  });

  it("list returns newest-first and excludes hidden stickers", async () => {
    const adapter = createMemoryAdapter();
    const a = await adapter.put(makeBlob(), { width: 100, height: 100 });
    const b = await adapter.put(makeBlob(), { width: 100, height: 100 });
    const c = await adapter.put(makeBlob(), { width: 100, height: 100 });
    await adapter.hide(b.id, "test");

    const page = await adapter.list(null, 10);
    expect(page.items.map((s) => s.id)).toEqual([c.id, a.id]);
    expect(page.nextCursor).toBeNull();
  });

  it("list paginates via cursor", async () => {
    const adapter = createMemoryAdapter();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const sticker = await adapter.put(makeBlob(), { width: 50, height: 50 });
      ids.push(sticker.id);
    }
    const page1 = await adapter.list(null, 2);
    expect(page1.items).toHaveLength(2);
    expect(page1.items.map((s) => s.id)).toEqual([ids[4], ids[3]]);
    expect(page1.nextCursor).toBe(ids[3]);

    const page2 = await adapter.list(page1.nextCursor, 2);
    expect(page2.items.map((s) => s.id)).toEqual([ids[2], ids[1]]);
    expect(page2.nextCursor).toBe(ids[1]);

    const page3 = await adapter.list(page2.nextCursor, 2);
    expect(page3.items.map((s) => s.id)).toEqual([ids[0]]);
    expect(page3.nextCursor).toBeNull();
  });

  it("hide is idempotent and ignores unknown ids", async () => {
    const adapter = createMemoryAdapter();
    await expect(adapter.hide("nope")).resolves.toBeUndefined();
    const sticker = await adapter.put(makeBlob(), { width: 50, height: 50 });
    await adapter.hide(sticker.id);
    await adapter.hide(sticker.id); // second hide is a no-op
    const page = await adapter.list();
    expect(page.items.find((s) => s.id === sticker.id)).toBeUndefined();
  });
});
