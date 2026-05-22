import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __resetLimiterCacheForTests, checkIpLimit } from "../ip";

const originalEnv = { ...process.env };

describe("checkIpLimit", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    __resetLimiterCacheForTests();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    __resetLimiterCacheForTests();
  });

  it("allows when Upstash env is missing in development", async () => {
    process.env.NODE_ENV = "development";
    const result = await checkIpLimit("1.2.3.4");
    expect(result.ok).toBe(true);
  });

  it("fails closed in production when Upstash env is missing", async () => {
    process.env.NODE_ENV = "production";
    const result = await checkIpLimit("1.2.3.4");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("config_missing");
  });
});
