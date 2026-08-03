// Multi-user access management: token lifecycle (issue/expire/renew), expiry
// rejection, per-user restrictions (model/provider allow-lists, rate limit,
// usage quota), and role gating.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-users-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

const futureISO = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
const pastISO = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const DUMMY_HASH = "bcrypt$2a$10$dummy-hash-for-testing";

async function makeUser(overrides = {}) {
  return db.createUser({
    username: `user-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    passwordHash: DUMMY_HASH,
    role: "member",
    restrictions: {},
    isActive: true,
    ...overrides,
  });
}

describe("user token util", async () => {
  const { isUserToken, verifyUserTokenCrc, generateUserToken } = await import("@/shared/utils/userToken.js");

  it("generates sk-user- tokens distinct from machine keys", () => {
    const { key } = generateUserToken();
    expect(key.startsWith("sk-user-")).toBe(true);
    expect(isUserToken(key)).toBe(true);
    expect(isUserToken("sk-abc-xyz")).toBe(false);
    expect(isUserToken("sk-user-x-y")).toBe(true); // prefix match; CRC is what validates
  });

  it("verifies CRC", () => {
    const { key } = generateUserToken();
    expect(verifyUserTokenCrc(key)).toBe(true);
    expect(verifyUserTokenCrc("sk-user-xxxxxx-deadbeef")).toBe(false);
  });
});

describe("user + token lifecycle", () => {
  it("creates users and issues tokens", async () => {
    const user = await makeUser();
    const token = await db.createUserToken(user.id, { name: "dev", expiresAt: futureISO(30) });
    expect(token.key.startsWith("sk-user-")).toBe(true);
    expect(token.expiresAt).toBeTruthy();

    const found = await db.validateUserToken(token.key);
    expect(found).not.toBeNull();
    expect(found.user.id).toBe(user.id);
    expect(found.token.id).toBe(token.id);
  });

  it("rejects a token whose expiry passed (401 path)", async () => {
    const user = await makeUser();
    const token = await db.createUserToken(user.id, { name: "expired", expiresAt: pastISO(1) });
    const found = await db.validateUserToken(token.key);
    expect(found).toBeNull();
  });

  it("renews an expired token by extending the date", async () => {
    const user = await makeUser();
    const token = await db.createUserToken(user.id, { name: "renew", expiresAt: pastISO(1) });
    expect(await db.validateUserToken(token.key)).toBeNull();

    // Token is surfaced as "marked expired" until renewed.
    const before = await db.getUserTokenByKey(token.key);
    expect(before.isExpired).toBe(true);

    await db.updateUserToken(token.id, { expiresAt: futureISO(30) });
    const found = await db.validateUserToken(token.key);
    expect(found).not.toBeNull();
    expect(found.token.expiresAt > pastISO(0)).toBe(true);
    expect(found.token.isExpired).toBe(false);
  });

  it("supports never-expiring tokens", async () => {
    const user = await makeUser();
    const token = await db.createUserToken(user.id, { name: "forever" });
    expect(token.expiresAt).toBeNull();
    expect(await db.validateUserToken(token.key)).not.toBeNull();
  });

  it("rejects inactive tokens and tokens of inactive users", async () => {
    const user = await makeUser();
    const token = await db.createUserToken(user.id, {});
    await db.updateUserToken(token.id, { isActive: false });
    expect(await db.validateUserToken(token.key)).toBeNull();

    await db.updateUserToken(token.id, { isActive: true });
    await db.updateUser(user.id, { isActive: false });
    expect(await db.validateUserToken(token.key)).toBeNull();
  });

  it("rejects user tokens via the machine-key validator (no collision)", async () => {
    const user = await makeUser();
    const token = await db.createUserToken(user.id, {});
    expect(await db.validateApiKey(token.key)).toBe(false);
    // Machine keys never validate as user tokens either.
    const machine = await db.createApiKey("machine", "mach000000000000");
    expect(machine.key.startsWith("sk-user-")).toBe(false);
    expect(await db.validateUserToken(machine.key)).toBeNull();
  });

  it("deleting a user removes their tokens", async () => {
    const user = await makeUser();
    const token = await db.createUserToken(user.id, {});
    await db.deleteUser(user.id);
    expect(await db.validateUserToken(token.key)).toBeNull();
    expect(await db.getUserTokens(user.id)).toEqual([]);
  });
});

describe("restriction matching", async () => {
  const { isModelAllowed, isProviderAllowed } = await import("@/sse/services/userAccess.js");

  it("allow-lists with wildcards", () => {
    const restrictions = { models: ["gpt-4o", "claude-3-5-*"], providers: ["openai", "claude"] };
    expect(isModelAllowed(restrictions, "gpt-4o")).toBe(true);
    expect(isModelAllowed(restrictions, "claude-3-5-sonnet-20241022")).toBe(true);
    expect(isModelAllowed(restrictions, "gemini-2.0-flash")).toBe(false);
    expect(isModelAllowed({}, "anything")).toBe(true);
    expect(isProviderAllowed(restrictions, "openai")).toBe(true);
    expect(isProviderAllowed(restrictions, "claude")).toBe(true);
    expect(isProviderAllowed(restrictions, "gemini")).toBe(false);
    expect(isProviderAllowed({}, "gemini")).toBe(true);
  });
});

describe("enforcement at the gateway", async () => {
  const { enforceChatAccess, loadUserFromToken } = await import("@/sse/services/userAccess.js");

  it("rejects an expired token with 401", async () => {
    const user = await makeUser();
    const token = await db.createUserToken(user.id, { expiresAt: pastISO(1) });
    const gate = await enforceChatAccess(token.key, "gpt-4o");
    expect(gate.ok).toBe(false);
    expect(gate.status).toBe(401);
  });

  it("blocks models not on the allow-list with 403", async () => {
    const user = await makeUser({ restrictions: { models: ["gpt-4o"] } });
    const token = await db.createUserToken(user.id, {});
    const blocked = await enforceChatAccess(token.key, "gemini-2.0-flash");
    expect(blocked.ok).toBe(false);
    expect(blocked.status).toBe(403);
    const allowed = await enforceChatAccess(token.key, "gpt-4o");
    expect(allowed.ok).toBe(true);
  });

  it("blocks providers not on the allow-list with 403 (provider/model form)", async () => {
    const user = await makeUser({ restrictions: { providers: ["openai"] } });
    const token = await db.createUserToken(user.id, {});
    const blocked = await enforceChatAccess(token.key, "claude/claude-3-5-sonnet-20241022");
    expect(blocked.ok).toBe(false);
    expect(blocked.status).toBe(403);
    const allowed = await enforceChatAccess(token.key, "openai/gpt-4o");
    expect(allowed.ok).toBe(true);
  });

  it("enforces per-user rate limit with 429", async () => {
    const user = await makeUser({ restrictions: { rateLimitPerMinute: 2 } });
    const token = await db.createUserToken(user.id, {});
    expect((await enforceChatAccess(token.key, "gpt-4o")).ok).toBe(true);
    expect((await enforceChatAccess(token.key, "gpt-4o")).ok).toBe(true);
    const third = await enforceChatAccess(token.key, "gpt-4o");
    expect(third.ok).toBe(false);
    expect(third.status).toBe(429);
    expect(third.retryAfter).toBeGreaterThan(0);
  });

  it("enforces monthly usage quota aggregated across the user's tokens", async () => {
    const user = await makeUser({ restrictions: { quota: { monthlyRequests: 1 } } });
    const tokenA = await db.createUserToken(user.id, {});
    const tokenB = await db.createUserToken(user.id, {});
    expect((await enforceChatAccess(tokenA.key, "gpt-4o")).ok).toBe(true);

    // Simulate a completed request recorded against tokenB.
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKey: tokenB.key,
      tokens: { prompt_tokens: 5, completion_tokens: 5 },
      endpoint: "/v1/chat/completions",
      status: "ok",
    });

    const gate = await enforceChatAccess(tokenA.key, "gpt-4o");
    expect(gate.ok).toBe(false);
    expect(gate.status).toBe(429);
  });

  it("loadUserFromToken returns user + token for a valid key", async () => {
    const user = await makeUser();
    const token = await db.createUserToken(user.id, {});
    const session = await loadUserFromToken(token.key);
    expect(session.ok).toBe(true);
    expect(session.user.id).toBe(user.id);
  });
});

describe("admin bootstrap", () => {
  it("ensureAdminUser creates exactly one admin", async () => {
    const a = await db.ensureAdminUser(DUMMY_HASH, "admin");
    expect(a.role).toBe("admin");
    const b = await db.ensureAdminUser(DUMMY_HASH, "admin");
    expect(b.id).toBe(a.id);
    expect(await db.getAdminUser()).toMatchObject({ id: a.id, role: "admin" });
  });

  it("createUser rejects duplicate usernames", async () => {
    await db.createUser({ username: "dupuser", passwordHash: DUMMY_HASH });
    await expect(db.createUser({ username: "dupuser", passwordHash: DUMMY_HASH })).rejects.toThrow();
  });
});
