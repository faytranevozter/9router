import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateKeyExpiration, isKeyExpired, expirationToLocalInput, localInputToExpiration } from "../../src/shared/utils/keyExpiration.js";

vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "machine-1" }));

const NOW = Date.parse("2026-10-18T00:00:00.000Z");
const FUTURE = "2026-10-19T00:00:00.000Z";
const originalDataDir = process.env.DATA_DIR;
let tempDir, db, gate;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-expiration-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  gate = (await import("../../src/sse/services/auth.js")).checkApiKeyQuota;
});

afterEach(() => {
  global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  vi.useRealTimers();
});

describe("expiration rules", () => {
  it("accepts null and normalizes explicit timezone offsets", () => {
    expect(validateKeyExpiration(null)).toEqual({ ok: true, value: null });
    expect(validateKeyExpiration("2026-10-19T07:00:00+07:00").value).toBe(FUTURE);
  });
  it.each(["", "2026-10-19", "2026-10-19T00:00:00", "2027-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "2026-10-19T24:00:00Z", "2026-10-19T00:00:00+24:00", 42, {}, "2026-10-18T00:00:00Z"])("rejects invalid or non-future input %j", (value) => {
    expect(validateKeyExpiration(value).ok).toBe(false);
  });
  it("fails closed for corrupt stored values, but allows missing expiry", () => {
    expect(isKeyExpired(undefined)).toBe(false);
    expect(isKeyExpired(null)).toBe(false);
    expect(isKeyExpired("")).toBe(true);
    expect(isKeyExpired("invalid")).toBe(true);
    expect(isKeyExpired(FUTURE)).toBe(false);
    expect(isKeyExpired(new Date(NOW).toISOString())).toBe(true);
  });
  it("round trips local input and rejects missing input", () => {
    expect(localInputToExpiration(expirationToLocalInput(FUTURE)).value).toBe(FUTURE);
    expect(localInputToExpiration("").ok).toBe(false);
  });
});

describe("repository and authentication", () => {
  it("keeps non-expiring keys backward compatible", async () => {
    const key = await db.createApiKey("Never", "machine-1");
    expect(key.expiresAt).toBeNull();
    expect(await db.validateApiKey(key.key)).toBe(true);
    expect(await gate(null, false)).toBeNull();
    expect(await gate("unknown", false)).toBeNull();
  });
  it("rejects at the exact boundary in both modes before quota, retains records and usage", async () => {
    const key = await db.createApiKey("Temporary", "machine-1", { expiresAt: FUTURE, tokenLimit: 1 });
    expect((await db.getApiKeyByKey(key.key)).expiresAt).toBe(FUTURE);
    expect(await gate(key.key, true)).toBeNull();
    await db.updateApiKey(key.id, { usedTokens: 10 });
    vi.setSystemTime(Date.parse(FUTURE));
    expect(await db.validateApiKey(key.key)).toBe(false);
    for (const required of [true, false]) expect(await gate(key.key, required)).toEqual({ error: "API key has expired", status: 401 });
    const updated = await db.updateApiKey(key.id, { name: "Renamed" });
    expect(updated.expiresAt).toBe(FUTURE);
    expect(updated.usedTokens).toBe(10);
    expect((await db.getApiKeys()).some((row) => row.id === key.id)).toBe(true);
    await db.updateApiKey(key.id, { expiresAt: null });
    expect((await gate(key.key, true)).status).toBe(429);
    await db.updateApiKey(key.id, { isActive: false, usedTokens: 0 });
    await db.updateApiKey(key.id, { expiresAt: "2026-10-20T00:00:00Z" });
    expect(await gate(key.key, true)).toEqual({ error: "API key is paused", status: 401 });
    await db.updateApiKey(key.id, { isActive: true });
    expect(await gate(key.key, true)).toBeNull();
  });
  it("validates direct repository writes and corrupt stored expiry", async () => {
    await expect(db.createApiKey("Bad", "machine-1", { expiresAt: "bad" })).rejects.toThrow();
    const key = await db.createApiKey("Good", "machine-1");
    await expect(db.updateApiKey(key.id, { expiresAt: "bad" })).rejects.toThrow();
    global._dbAdapter.instance.run("UPDATE apiKeys SET expiresAt = ? WHERE id = ?", ["bad", key.id]);
    expect(await db.validateApiKey(key.key)).toBe(false);
    expect((await gate(key.key, false)).status).toBe(401);
  });
  it("adds expiration to an existing database without invalidating keys", async () => {
    global._dbAdapter.instance.close();
    delete global._dbAdapter;
    fs.rmSync(path.join(tempDir, "db"), { recursive: true, force: true });
    const legacy = new DatabaseSync(path.join(tempDir, "legacy.sqlite"));
    legacy.exec("CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1, createdAt TEXT NOT NULL)");
    legacy.exec("INSERT INTO apiKeys VALUES ('old', 'sk-old', 'Old', 'm', 1, '2026-01-01T00:00:00Z')");
    legacy.close();
    fs.mkdirSync(path.join(tempDir, "db"));
    fs.renameSync(path.join(tempDir, "legacy.sqlite"), path.join(tempDir, "db", "data.sqlite"));
    vi.resetModules();
    const migrated = await import("@/lib/db/index.js");
    await migrated.initDb();
    expect((await migrated.getApiKeyByKey("sk-old")).expiresAt).toBeNull();
    expect(await migrated.validateApiKey("sk-old")).toBe(true);
  });
});

describe("management APIs and CLI resolution", () => {
  const request = (body) => new Request("http://localhost/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  it("creates, updates, preserves, and clears expiration via the real routes", async () => {
    const { POST } = await import("../../src/app/api/keys/route.js");
    const { PUT } = await import("../../src/app/api/keys/[id]/route.js");
    const response = await POST(request({ name: "API", expiresAt: FUTURE }));
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.expiresAt).toBe(FUTURE);
    const context = { params: Promise.resolve({ id: created.id }) };
    expect((await PUT(request({ expiresAt: "bad" }), context)).status).toBe(400);
    vi.setSystemTime(Date.parse(FUTURE));
    const renamed = await (await PUT(request({ name: "Changed" }), context)).json();
    expect(renamed.key.expiresAt).toBe(FUTURE);
    expect((await PUT(request({ expiresAt: FUTURE }), context)).status).toBe(400);
    const cleared = await (await PUT(request({ expiresAt: null }), context)).json();
    expect(cleared.key.expiresAt).toBeNull();
    expect(cleared.key.key).toBe(created.key);
    expect((await POST(request({ name: "Bad", expiresAt: "" }))).status).toBe(400);
  });
  it("does not automatically select expired keys, including a known supplied expired key", async () => {
    const old = await db.createApiKey("Expiring", "machine-1", { expiresAt: FUTURE });
    const good = await db.createApiKey("Never", "machine-1");
    vi.setSystemTime(Date.parse(FUTURE));
    const { resolveCliApiKey } = await import("../../src/app/api/cli-tools/resolveApiKey.js");
    expect(await resolveCliApiKey("")).toBe(good.key);
    expect(await resolveCliApiKey(old.key)).toBe(good.key);
    expect(await resolveCliApiKey("external-key")).toBe("external-key");
  });
});
