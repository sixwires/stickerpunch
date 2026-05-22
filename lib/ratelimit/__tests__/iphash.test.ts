import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashIp } from "../iphash";

const originalEnv = { ...process.env };

describe("hashIp", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns the same hash for the same IP + salt", async () => {
    process.env.RATELIMIT_SALT = "test-salt";
    const a = await hashIp("1.2.3.4");
    const b = await hashIp("1.2.3.4");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs across salts", async () => {
    process.env.RATELIMIT_SALT = "salt-one";
    const a = await hashIp("9.9.9.9");
    process.env.RATELIMIT_SALT = "salt-two";
    const b = await hashIp("9.9.9.9");
    expect(a).not.toBe(b);
  });

  it("throws in production when RATELIMIT_SALT is missing", async () => {
    delete process.env.RATELIMIT_SALT;
    process.env.NODE_ENV = "production";
    await expect(hashIp("1.1.1.1")).rejects.toThrow(/RATELIMIT_SALT/);
  });
});
