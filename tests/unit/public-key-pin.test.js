import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validatePublicPin } from "../../src/shared/utils/publicKeyPin.js";

const originalDataDir = process.env.DATA_DIR;
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
let tempDir;
let db;
let getApiKeyById;
let updateApiKey;
let exportDb;
let getPublicKeyGate;

function writeLegacyDb(dir) {
  fs.mkdirSync(path.join(dir, "db"), { recursive: true });
  const legacy = new DatabaseSync(path.join(dir, "db", "data.sqlite"));
  legacy.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  legacy.exec("INSERT INTO _meta(key, value) VALUES ('schemaVersion', '5'), ('backupSchemaVersion', '5')");
  legacy.exec("CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1, tokenLimit INTEGER DEFAULT 0, usedTokens INTEGER DEFAULT 0, expiresAt TEXT, createdAt TEXT NOT NULL, updatedAt TEXT, accessRestricted INTEGER DEFAULT 0, accessAllow TEXT, publicShare INTEGER DEFAULT 0)");
  legacy.exec("INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, publicShare) VALUES ('legacy', 'sk-legacy', 'Legacy', 'm', 1, '2026-01-01T00:00:00.000Z', 1)");
  legacy.close();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-18T00:00:00.000Z"));
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-public-pin-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("../../src/lib/db/index.js");
  await db.initDb();
  ({ getApiKeyById, updateApiKey, exportDb } = db);
  ({ getPublicKeyGate } = await import("../../src/lib/publicKeySummary.js"));
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  vi.useRealTimers();
});

async function makeKey(name = "PIN key") { return db.createApiKey(name, "machine-pin", { publicShare: true }); }
const putRequest = (id, body) => new Request(`http://localhost/api/keys/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const putContext = (id) => ({ params: Promise.resolve({ id }) });

describe("public status PIN", () => {
  it("validates only 6–12 digit strings, with null as the only removal value", () => {
    for (const value of ["123456", "012345678901"]) expect(validatePublicPin(value).ok).toBe(true);
    expect(validatePublicPin(null)).toEqual({ ok: true, value: null });
    for (const value of ["12345", "1234567890123", "abcdef", "12 34 56", 123456, "", {}, undefined]) expect(validatePublicPin(value).ok).toBe(false);
  });

  it("adds the column to schema v5 and reads existing rows as not protected", async () => {
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    fs.rmSync(path.join(tempDir, "db"), { recursive: true, force: true });
    writeLegacyDb(tempDir);
    vi.resetModules();
    const fresh = await import("../../src/lib/db/index.js");
    await fresh.initDb();
    const { getAdapter } = await import("../../src/lib/db/driver.js");
    const adapter = await getAdapter();
    expect(adapter.all("PRAGMA table_info(apiKeys)").map((column) => column.name)).toContain("publicPinHash");
    expect((await fresh.getApiKeyById("legacy")).publicPinSet).toBe(false);
  });

  it("sets/removes a hash through PUT; rejects invalid values; preserves omitted PINs; redacts all serialized API output", async () => {
    const key = await makeKey();
    const { PUT, GET } = await import("../../src/app/api/keys/[id]/route.js");
    const set = await PUT(putRequest(key.id, { publicPin: "123456" }), putContext(key.id));
    expect(set.status).toBe(200);
    const body = await set.json();
    expect(body.key.publicPinSet).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/\$2[aby]\$/);
    let row = await (await import("../../src/lib/db/driver.js")).getAdapter().then((adapter) => adapter.get("SELECT publicPinHash FROM apiKeys WHERE id = ?", [key.id]));
    expect(row.publicPinHash).toMatch(/^\$2[aby]\$/);
    const savedHash = row.publicPinHash;

    const invalid = await PUT(putRequest(key.id, { publicPin: "12345" }), putContext(key.id));
    expect(invalid.status).toBe(400);
    row = await (await import("../../src/lib/db/driver.js")).getAdapter().then((adapter) => adapter.get("SELECT publicPinHash FROM apiKeys WHERE id = ?", [key.id]));
    expect(row.publicPinHash).toBe(savedHash);

    const unrelated = await PUT(putRequest(key.id, { name: "Renamed" }), putContext(key.id));
    expect((await unrelated.json()).key.publicPinSet).toBe(true);
    const listed = await (await import("../../src/app/api/keys/route.js")).GET();
    expect(JSON.stringify(await listed.json())).not.toContain(savedHash);
    const single = await GET(new Request(`http://localhost/api/keys/${key.id}`), putContext(key.id));
    expect(JSON.stringify(await single.json())).not.toContain(savedHash);

    const removed = await PUT(putRequest(key.id, { publicPin: null }), putContext(key.id));
    expect((await removed.json()).key.publicPinSet).toBe(false);
    const removedHash = (await (await import("../../src/lib/db/driver.js")).getAdapter()).get("SELECT publicPinHash FROM apiKeys WHERE id = ?", [key.id]);
    expect(removedHash.publicPinHash).toBeNull();
  });

  it("returns the uniform share gate state and requires PIN only for protected shared keys", async () => {
    expect(await getPublicKeyGate(null)).toEqual({ shared: false });
    expect(await getPublicKeyGate("unknown")).toEqual({ shared: false });
    const key = await makeKey();
    expect(await getPublicKeyGate(key.id)).toEqual({ shared: true, pinRequired: false });
    await updateApiKey(key.id, { publicPinHash: "placeholder-hash" });
    expect(await getPublicKeyGate(key.id)).toEqual({ shared: true, pinRequired: true });
    await updateApiKey(key.id, { publicShare: false });
    expect(await getPublicKeyGate(key.id)).toEqual({ shared: false });
  });

  it("scopes unlock JWTs by key and invalidates them on PIN change/removal/expiry", async () => {
    const { createHmac } = await import("node:crypto");
    const { cookies } = await import("next/headers");
    const { SignJWT } = await import("jose");
    const { getJwtSecretMaterial } = await import("../../src/lib/auth/dashboardSession.js");
    const { hashPublicPin, isPublicKeyUnlocked } = await import("../../src/lib/auth/publicPin.js");
    const key = await makeKey();
    const other = await makeKey("Other");
    const oldHash = await hashPublicPin("123456");
    await updateApiKey(key.id, { publicPinHash: oldHash });
    await updateApiKey(other.id, { publicPinHash: await hashPublicPin("111111") });
    const signingKey = createHmac("sha256", getJwtSecretMaterial()).update(`public-pin:${oldHash}`).digest();
    const token = await new SignJWT({ kid: key.id, scope: "public-key-pin" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(signingKey);
    const cookieName = `k_pin_${Buffer.from(key.id).toString("base64url")}`;
    vi.mocked(cookies).mockResolvedValue({ get: (name) => name === cookieName ? { value: token } : undefined });
    const auth = await import("../../src/lib/auth/publicPin.js");
    expect(await auth.isPublicKeyUnlocked(key.id)).toBe(true);
    expect(await auth.isPublicKeyUnlocked(other.id)).toBe(false);
    const changed = await hashPublicPin("654321");
    await updateApiKey(key.id, { publicPinHash: changed });
    expect(await auth.isPublicKeyUnlocked(key.id)).toBe(false);
    await updateApiKey(key.id, { publicPinHash: null });
    expect(await auth.isPublicKeyUnlocked(key.id)).toBe(true);

    await updateApiKey(key.id, { publicPinHash: oldHash });
    const expiredToken = await new SignJWT({ kid: key.id, scope: "public-key-pin" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1s").sign(signingKey);
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: expiredToken }) });
    vi.setSystemTime(Date.now() + 2_000);
    expect(await auth.isPublicKeyUnlocked(key.id)).toBe(false);
  });

  it("sets scoped httpOnly 30-day cookies and progressively locks each visitor/key", async () => {
    const key = await makeKey();
    const { hashPublicPin, grantPublicPinCookie } = await import("../../src/lib/auth/publicPin.js");
    const hash = await hashPublicPin("123456");
    const cookieStore = { set: vi.fn() };
    await grantPublicPinCookie(cookieStore, new Request("https://example.test/k/id", { headers: { "x-forwarded-proto": "https" } }), key.id, hash);
    expect(cookieStore.set).toHaveBeenCalledWith(expect.stringMatching(/^k_pin_/), expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: "lax", path: `/k/${key.id}`, maxAge: 2_592_000, secure: true }));

    const limiter = await import("../../src/lib/auth/publicPinLimiter.js");
    const request = new Request("http://localhost", { headers: { "x-forwarded-for": "192.0.2.1" } });
    for (let i = 0; i < 5; i++) limiter.recordFail(request, key.id);
    expect(limiter.checkLock(request, key.id)).toMatchObject({ locked: true, retryAfter: expect.any(Number) });
    expect(limiter.checkLock(request, "another-key").locked).toBe(false);
  });

  it("re-locks an existing holder when an API PIN update changes or removes the PIN", async () => {
    const key = await makeKey();
    const { PUT } = await import("../../src/app/api/keys/[id]/route.js");
    await PUT(putRequest(key.id, { publicPin: "123456" }), putContext(key.id));
    const { createHmac } = await import("node:crypto");
    const { SignJWT } = await import("jose");
    const { cookies } = await import("next/headers");
    const { getJwtSecretMaterial } = await import("../../src/lib/auth/dashboardSession.js");
    const { isPublicKeyUnlocked } = await import("../../src/lib/auth/publicPin.js");
    const { getAdapter } = await import("../../src/lib/db/driver.js");
    const hash = (await getAdapter()).get("SELECT publicPinHash FROM apiKeys WHERE id = ?", [key.id]).publicPinHash;
    const jwtKey = createHmac("sha256", getJwtSecretMaterial()).update(`public-pin:${hash}`).digest();
    const token = await new SignJWT({ kid: key.id, scope: "public-key-pin" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(jwtKey);
    const name = `k_pin_${Buffer.from(key.id).toString("base64url")}`;
    vi.mocked(cookies).mockResolvedValue({ get: (cookieName) => cookieName === name ? { value: token } : undefined });
    expect(await isPublicKeyUnlocked(key.id)).toBe(true);
    await PUT(putRequest(key.id, { publicPin: "654321" }), putContext(key.id));
    expect(await isPublicKeyUnlocked(key.id)).toBe(false);
    await PUT(putRequest(key.id, { publicPin: null }), putContext(key.id));
    expect(await isPublicKeyUnlocked(key.id)).toBe(true);
  });

  it("does not include hashes in backup exports", async () => {
    const key = await makeKey();
    await updateApiKey(key.id, { publicPinHash: "$2b$10$private-hash-value" });
    const backup = await exportDb();
    expect(JSON.stringify(backup)).not.toContain("private-hash-value");
    expect(backup.apiKeys.find((entry) => entry.id === key.id)).not.toHaveProperty("publicPinHash");
  });

  it("only reveals the API key through the protected, unlocked public-secret endpoint", async () => {
    const key = await makeKey();
    const { GET } = await import("../../src/app/k/[id]/secret/route.js");
    const context = { params: Promise.resolve({ id: key.id }) };
    let response = await GET(new Request(`http://localhost/k/${key.id}/secret`), context);
    expect(response.status).toBe(404);

    const { hashPublicPin } = await import("../../src/lib/auth/publicPin.js");
    await updateApiKey(key.id, { publicPinHash: await hashPublicPin("123456") });
    response = await GET(new Request(`http://localhost/k/${key.id}/secret`), context);
    expect(response.status).toBe(404);

    const { cookies } = await import("next/headers");
    const { createHmac } = await import("node:crypto");
    const { SignJWT } = await import("jose");
    const { getJwtSecretMaterial } = await import("../../src/lib/auth/dashboardSession.js");
    const hash = (await (await import("../../src/lib/db/driver.js")).getAdapter()).get("SELECT publicPinHash FROM apiKeys WHERE id=?", [key.id]).publicPinHash;
    const tokenKey = createHmac("sha256", getJwtSecretMaterial()).update(`public-pin:${hash}`).digest();
    const token = await new SignJWT({ kid: key.id, scope: "public-key-pin" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(tokenKey);
    const name = `k_pin_${Buffer.from(key.id).toString("base64url")}`;
    vi.mocked(cookies).mockResolvedValue({ get: (cookieName) => cookieName === name ? { value: token } : undefined });
    response = await GET(new Request(`http://localhost/k/${key.id}/secret`), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ key: expect.stringMatching(/^sk-/) });
    await updateApiKey(key.id, { publicShare: false });
    response = await GET(new Request(`http://localhost/k/${key.id}/secret`), context);
    expect(response.status).toBe(404);
  });
});
