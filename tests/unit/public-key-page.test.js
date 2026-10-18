// Public per-key status page (/k/{id}).
//
// Covers the publicShare column and its management-API round-trip, the uniform
// "not available" gate (unknown id ≡ sharing off), the payload the page renders,
// status precedence against checkApiKeyQuota, the per-key model filter, the
// quota projection, and the split-out key-access context builder.
//
// Runs against a real temp SQLite DB (initDb) so the additive schema column,
// the repo round-trip and the usage queries all execute for real.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: async () => "machine-1",
}));

const NOW = Date.parse("2026-10-18T00:00:00.000Z");
const FUTURE = "2026-10-19T00:00:00.000Z";
const originalDataDir = process.env.DATA_DIR;
const originalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;

let tempDir;
let db;
let gate;
let buildPublicKeySummary;
let keyAccess;

// The apiKeys DDL as it was before publicShare: schemaVersion 4.
function writeLegacyDb(dir) {
  fs.mkdirSync(path.join(dir, "db"), { recursive: true });
  const legacy = new DatabaseSync(path.join(dir, "db", "data.sqlite"));
  legacy.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  legacy.exec(`INSERT INTO _meta(key, value) VALUES ('schemaVersion', '4'), ('backupSchemaVersion', '4')`);
  legacy.exec(`CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1, tokenLimit INTEGER DEFAULT 0, usedTokens INTEGER DEFAULT 0, expiresAt TEXT, createdAt TEXT NOT NULL, updatedAt TEXT, accessRestricted INTEGER DEFAULT 0, accessAllow TEXT)`);
  legacy.exec(`INSERT INTO apiKeys(id, key, name, machineId, isActive, tokenLimit, usedTokens, createdAt) VALUES ('old', 'sk-old', 'Old', 'm', 1, 0, 0, '2026-01-01T00:00:00.000Z')`);
  legacy.close();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  delete process.env.NEXT_PUBLIC_BASE_URL;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-public-key-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  ({ checkApiKeyQuota: gate } = await import("../../src/sse/services/auth.js"));
  ({ buildPublicKeySummary } = await import("../../src/lib/publicKeySummary.js"));
  keyAccess = await import("../../src/sse/services/keyAccess.js");
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = originalBaseUrl;
  vi.useRealTimers();
});

async function makeKey(name, options = {}) {
  return db.createApiKey(name, "machine-1", options);
}

async function seedUsage(key, entries) {
  let i = 0;
  for (const entry of entries) {
    await db.saveRequestUsage({
      timestamp: new Date(NOW + i * 1000).toISOString(),
      provider: entry.provider || "openai",
      model: entry.model || "gpt-5.5",
      connectionId: "conn-1",
      apiKey: key.key,
      tokens: entry.tokens,
      endpoint: entry.endpoint || "/v1/chat/completions",
      status: "ok",
    });
    i++;
  }
}

const putRequest = (id, body) => new Request(`http://localhost/api/keys/${id}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const putContext = (id) => ({ params: Promise.resolve({ id }) });

describe("publicShare column: additive sync onto an existing database", () => {
  it("adds publicShare and reads every existing row as false", async () => {
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    fs.rmSync(path.join(tempDir, "db"), { recursive: true, force: true });
    writeLegacyDb(tempDir);

    vi.resetModules();
    const fresh = await import("@/lib/db/index.js");
    const freshSummary = await import("@/lib/publicKeySummary.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    await fresh.initDb();

    const cols = adapter.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["publicShare"]));

    const key = await fresh.getApiKeyByKey("sk-old");
    expect(key.publicShare).toBe(false);
    // Sharing off for a legacy row means the page stays unavailable.
    expect(await freshSummary.buildPublicKeySummary("old")).toEqual({ found: false });
  });
});

describe("/api/keys routes carry publicShare", () => {
  const postRequest = (body) => new Request("http://localhost/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  it("creates with publicShare=false by default and true when asked", async () => {
    const { POST } = await import("../../src/app/api/keys/route.js");
    const plain = await (await POST(postRequest({ name: "plain" }))).json();
    expect(plain.publicShare).toBe(false);
    expect((await db.getApiKeyById(plain.id)).publicShare).toBe(false);

    const shared = await (await POST(postRequest({ name: "shared", publicShare: true }))).json();
    expect(shared.publicShare).toBe(true);
    expect((await db.getApiKeyById(shared.id)).publicShare).toBe(true);
  });

  it("rejects a non-boolean publicShare with 400 instead of coercing", async () => {
    const { POST } = await import("../../src/app/api/keys/route.js");
    for (const value of ["true", 1, {}, []]) {
      expect((await POST(postRequest({ name: "bad", publicShare: value }))).status).toBe(400);
    }
    const key = await makeKey("edit", {});
    const { PUT } = await import("../../src/app/api/keys/[id]/route.js");
    expect((await PUT(putRequest(key.id, { publicShare: "yes" }), putContext(key.id))).status).toBe(400);
    expect((await db.getApiKeyById(key.id)).publicShare).toBe(false);
  });

  it("round-trips the toggle through PUT and preserves it when omitted", async () => {
    const { PUT } = await import("../../src/app/api/keys/[id]/route.js");
    const key = await makeKey("toggled", {});

    let body = await (await PUT(putRequest(key.id, { publicShare: true }), putContext(key.id))).json();
    expect(body.key.publicShare).toBe(true);
    expect((await db.getApiKeyById(key.id)).publicShare).toBe(true);

    // An unrelated update must not silently revoke sharing.
    body = await (await PUT(putRequest(key.id, { name: "renamed" }), putContext(key.id))).json();
    expect(body.key.name).toBe("renamed");
    expect(body.key.publicShare).toBe(true);

    body = await (await PUT(putRequest(key.id, { publicShare: false }), putContext(key.id))).json();
    expect(body.key.publicShare).toBe(false);
  });

  it("GET /api/keys exposes the toggle so the dashboard can render it", async () => {
    const key = await makeKey("listed", { publicShare: true });
    const { GET } = await import("../../src/app/api/keys/route.js");
    const body = await (await GET()).json();
    expect(body.keys.find((k) => k.id === key.id).publicShare).toBe(true);
  });
});

describe("the sharing gate is uniform", () => {
  it("a key with sharing off is indistinguishable from a nonexistent id", async () => {
    const off = await makeKey("off", {});
    const missing = await buildPublicKeySummary("00000000-0000-4000-8000-000000000000");
    expect(missing).toEqual({ found: false });
    expect(await buildPublicKeySummary(off.id)).toEqual(missing);
  });

  it("refuses non-string and empty ids without touching the database", async () => {
    for (const id of [null, undefined, "", 42, {}]) {
      expect(await buildPublicKeySummary(id)).toEqual({ found: false });
    }
  });

  it("turning sharing off revokes an id that was previously readable", async () => {
    const key = await makeKey("revocable", { publicShare: true });
    expect((await buildPublicKeySummary(key.id)).found).toBe(true);
    await db.updateApiKey(key.id, { publicShare: false });
    expect(await buildPublicKeySummary(key.id)).toEqual({ found: false });
  });
});

describe("the public payload", () => {
  it("carries quota, status, expiration and endpoint for a shared key", async () => {
    const key = await makeKey("shared", { publicShare: true, tokenLimit: 1000, expiresAt: FUTURE });
    await db.updateApiKey(key.id, { usedTokens: 250 });

    const { found, summary } = await buildPublicKeySummary(key.id, { origin: "https://router.example" });
    expect(found).toBe(true);
    expect(summary.key).toMatchObject({
      id: key.id,
      name: "shared",
      status: "active",
      usable: true,
      expiresAt: FUTURE,
      expiresInDays: 1,
    });
    expect(summary.key.createdAt).toBeTruthy();
    expect(summary.quota).toEqual({
      tokenLimit: 1000,
      usedTokens: 250,
      remaining: 750,
      unlimited: false,
      percent: 25,
      exceeded: false,
      warning: false,
    });
    expect(summary.endpoint).toEqual({
      baseUrl: "https://router.example/v1",
      chatPath: "/chat/completions",
      exampleModel: expect.any(String),
    });
    expect(summary.usage.period).toBe("7d");
  });

  it("never contains the key, its masked form, the machine id, the allow list or cost", async () => {
    // The allow list holds one entry that resolves to nothing, so it can never
    // reappear legitimately through the model list — if it shows up at all, the
    // allow list itself leaked.
    const key = await makeKey("secretive", {
      publicShare: true,
      tokenLimit: 5000,
      access: { restricted: true, allow: ["openai/gpt-5.5", "private-allow-entry/none"] },
    });
    await seedUsage(key, [
      { model: "gpt-5.5", tokens: { prompt_tokens: 100, completion_tokens: 40 } },
      { model: "gpt-5.5", tokens: { prompt_tokens: 10, completion_tokens: 5 } },
    ]);
    const { summary } = await buildPublicKeySummary(key.id, { origin: "http://localhost:20127" });

    // Assert on the serialized page payload, so a nested leak fails too.
    const json = JSON.stringify(summary);
    expect(json).not.toContain(key.key);
    expect(json).not.toContain(key.key.slice(0, 8));
    expect(json).not.toContain("***");
    expect(json).not.toContain("machine-1");
    expect(json).not.toContain("private-allow-entry/none");
    expect(json).not.toContain("cost");
    expect(json).not.toContain("keyMasked");
    expect(json).not.toContain("conn-1");

    // …and on the field names, so a renamed leak is caught as well.
    expect(summary.key).not.toHaveProperty("key");
    expect(summary.key).not.toHaveProperty("keyMasked");
    expect(summary.key).not.toHaveProperty("machineId");
    expect(summary).not.toHaveProperty("access");
    expect(summary.key).not.toHaveProperty("access");
    expect(json).not.toContain("\"allow\"");
    for (const row of [...summary.usage.byModel, ...summary.usage.byProvider]) {
      expect(row).not.toHaveProperty("cost");
      expect(row).not.toHaveProperty("connectionId");
    }
    expect(summary.usage.totals).not.toHaveProperty("cost");
  });

  it("never puts the key in the curl example, only a placeholder model", async () => {
    const key = await makeKey("curl", { publicShare: true, access: { restricted: true, allow: ["openai/gpt-5.5"] } });
    const { summary } = await buildPublicKeySummary(key.id, { origin: "http://localhost:20127" });
    // A restricted key's example model is one it may actually call.
    expect(summary.models.map((m) => m.id)).toContain(summary.endpoint.exampleModel);
  });

  it("prefers NEXT_PUBLIC_BASE_URL over the request origin", async () => {
    const key = await makeKey("base", { publicShare: true });
    process.env.NEXT_PUBLIC_BASE_URL = "https://public.example/";
    const { summary } = await buildPublicKeySummary(key.id, { origin: "http://internal:20127" });
    expect(summary.endpoint.baseUrl).toBe("https://public.example/v1");
  });

  it("reports unlimited quota without a percentage or a remaining count", async () => {
    const key = await makeKey("unlimited", { publicShare: true });
    const { summary } = await buildPublicKeySummary(key.id);
    expect(summary.quota.unlimited).toBe(true);
    expect(summary.quota.remaining).toBeNull();
    expect(summary.quota.percent).toBe(0);
    expect(summary.quota.exceeded).toBe(false);
  });
});

describe("status precedence matches the request gate", () => {
  async function statusOf(key) {
    const { summary } = await buildPublicKeySummary(key.id);
    const allowed = (await gate(key.key, true)) === null;
    expect(summary.key.usable).toBe(allowed);
    return summary.key.status;
  }

  it("paused beats expired beats over-quota", async () => {
    const key = await makeKey("triple", { publicShare: true, tokenLimit: 10, expiresAt: FUTURE });
    await db.updateApiKey(key.id, { usedTokens: 10, isActive: false });
    vi.setSystemTime(Date.parse(FUTURE));
    expect(await statusOf(key)).toBe("paused");

    await db.updateApiKey(key.id, { isActive: true });
    expect(await statusOf(key)).toBe("expired");

    await db.updateApiKey(key.id, { expiresAt: null });
    expect(await statusOf(key)).toBe("quota_exceeded");
  });

  it("is usable exactly while checkApiKeyQuota allows the key, including the expiry boundary", async () => {
    const key = await makeKey("boundary", { publicShare: true, expiresAt: FUTURE });
    expect(await statusOf(key)).toBe("active");

    // One millisecond before expiry the gate still allows it.
    vi.setSystemTime(Date.parse(FUTURE) - 1);
    expect(await statusOf(key)).toBe("active");

    // At the boundary it is expired, exactly as the gate reports.
    vi.setSystemTime(Date.parse(FUTURE));
    expect(await statusOf(key)).toBe("expired");
    expect((await gate(key.key, true)).error).toBe("API key has expired");
  });

  it("still renders paused, expired and over-quota keys — they are shared on purpose", async () => {
    const paused = await makeKey("paused", { publicShare: true });
    await db.updateApiKey(paused.id, { isActive: false });
    const expired = await makeKey("expired", { publicShare: true, expiresAt: FUTURE });
    const over = await makeKey("over", { publicShare: true, tokenLimit: 5 });
    await db.updateApiKey(over.id, { usedTokens: 5 });
    vi.setSystemTime(Date.parse(FUTURE));

    expect((await buildPublicKeySummary(paused.id)).summary.key.status).toBe("paused");
    expect((await buildPublicKeySummary(expired.id)).summary.key.status).toBe("expired");
    expect((await buildPublicKeySummary(over.id)).summary.key.status).toBe("quota_exceeded");
    for (const key of [paused, expired, over]) {
      const { found, summary } = await buildPublicKeySummary(key.id);
      expect(found).toBe(true);
      expect(summary.key.usable).toBe(false);
    }
  });

  it("reports expiry in whole days, and null once it has passed", async () => {
    const key = await makeKey("days", { publicShare: true, expiresAt: "2026-10-21T00:00:00.000Z" });
    expect((await buildPublicKeySummary(key.id)).summary.key.expiresInDays).toBe(3);
    vi.setSystemTime(Date.parse("2026-10-21T00:00:00.000Z"));
    expect((await buildPublicKeySummary(key.id)).summary.key.expiresInDays).toBeNull();
    const never = await makeKey("never", { publicShare: true });
    expect((await buildPublicKeySummary(never.id)).summary.key.expiresInDays).toBeNull();
  });
});

describe("models are limited to what the key may call", () => {
  it("an unrestricted key sees the full LLM list", async () => {
    const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
    const key = await makeKey("unrestricted", { publicShare: true });
    const { summary } = await buildPublicKeySummary(key.id);
    const full = await buildModelsList(["llm"]);
    expect(summary.models.length).toBe(full.length);
    expect(summary.models.map((m) => m.id)).toEqual(full.map((m) => m.id));
  });

  it("a restricted key sees only its allowed combos and models, matching filterModelsListForKey", async () => {
    const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
    const combo = await db.createCombo({ name: "Public Combo", models: ["openai/gpt-5.5"] });
    const key = await makeKey("restricted", {
      publicShare: true,
      access: { restricted: true, allow: [combo.name] },
    });

    const { summary } = await buildPublicKeySummary(key.id);
    const record = await db.getApiKeyById(key.id);
    const expected = await keyAccess.filterModelsListForKey(
      keyAccess.keyAccessContextFromRecord(record),
      await buildModelsList(["llm"])
    );
    expect(summary.models.map((m) => m.id)).toEqual(expected.map((m) => m.id));
    expect(summary.models.map((m) => m.id)).toEqual([combo.name]);
    expect(summary.endpoint.exampleModel).toBe(combo.name);
  });

  it("a restricted key with an empty allow list sees no models", async () => {
    const key = await makeKey("nothing", { publicShare: true, access: { restricted: true, allow: [] } });
    const { summary } = await buildPublicKeySummary(key.id);
    expect(summary.models).toEqual([]);
    expect(summary.endpoint.exampleModel).toBeNull();
  });

  it("trims each model to the public fields only", async () => {
    const key = await makeKey("trimmed", { publicShare: true, access: { restricted: true, allow: ["openai/gpt-5.5"] } });
    const { summary } = await buildPublicKeySummary(key.id);
    const allowed = new Set(["id", "owned_by", "context_length", "max_completion_tokens", "capabilities"]);
    for (const model of summary.models) {
      for (const field of Object.keys(model)) expect(allowed.has(field)).toBe(true);
      if (model.capabilities) {
        for (const value of Object.values(model.capabilities)) expect(typeof value).toBe("boolean");
      }
    }
  });
});

describe("quota projection", () => {
  it("is null when the quota is unlimited", async () => {
    const key = await makeKey("unlimited-proj", { publicShare: true });
    await seedUsage(key, [{ tokens: { prompt_tokens: 100, completion_tokens: 100 } }]);
    expect((await buildPublicKeySummary(key.id)).summary.projection).toBeNull();
  });

  it("is null when there is no usage in the period", async () => {
    const key = await makeKey("idle", { publicShare: true, tokenLimit: 1000 });
    expect((await buildPublicKeySummary(key.id)).summary.projection).toBeNull();
  });

  it("is null once the quota is already exceeded", async () => {
    const key = await makeKey("spent", { publicShare: true, tokenLimit: 100 });
    await seedUsage(key, [{ tokens: { prompt_tokens: 60, completion_tokens: 60 } }]);
    const { summary } = await buildPublicKeySummary(key.id);
    expect(summary.quota.exceeded).toBe(true);
    expect(summary.projection).toBeNull();
  });

  it("extrapolates a future exhaustion date from the observed rate", async () => {
    const key = await makeKey("projecting", { publicShare: true, tokenLimit: 1000 });
    // 900 tokens across two requests on the same day: one active sample day.
    await seedUsage(key, [
      { tokens: { prompt_tokens: 500, completion_tokens: 200 } },
      { tokens: { prompt_tokens: 150, completion_tokens: 50 } },
    ]);
    // Lifetime counter reset, so 900 of the 1000 remain.
    await db.updateApiKey(key.id, { usedTokens: 100 });

    const { summary } = await buildPublicKeySummary(key.id);
    expect(summary.quota.remaining).toBe(900);
    expect(summary.projection.sampleDays).toBe(1);
    expect(summary.projection.avgTokensPerDay).toBe(900);
    // 900 remaining at 900 tokens/day ⇒ one day out.
    expect(Date.parse(summary.projection.projectedExhaustionAt)).toBe(NOW + 86400000);
    expect(summary.projection.projectedExhaustionAt > new Date(NOW).toISOString()).toBe(true);
  });

  it("measures the pace over active days, not a fixed week", async () => {
    const key = await makeKey("sparse", { publicShare: true, tokenLimit: 10000 });
    // Two distinct days in the window, 500 tokens total ⇒ 250/day.
    for (const [index, dayOffset] of [0, 1].entries()) {
      await db.saveRequestUsage({
        timestamp: new Date(NOW - dayOffset * 86400000 + index).toISOString(),
        provider: "openai",
        model: "gpt-5.5",
        connectionId: "conn-1",
        apiKey: key.key,
        tokens: { prompt_tokens: 250, completion_tokens: 0 },
        endpoint: "/v1/chat/completions",
        status: "ok",
      });
    }
    const { summary } = await buildPublicKeySummary(key.id);
    expect(summary.usage.daily.length).toBe(2);
    expect(summary.projection.sampleDays).toBe(2);
    expect(summary.projection.avgTokensPerDay).toBe(250);
  });
});

describe("usage breakdown", () => {
  it("reports totals, daily, by-model and by-provider without cost", async () => {
    const key = await makeKey("usage", { publicShare: true });
    await seedUsage(key, [
      { model: "gpt-5.5", provider: "openai", tokens: { prompt_tokens: 100, completion_tokens: 50 } },
      { model: "gpt-5.4", provider: "openai", tokens: { prompt_tokens: 20, completion_tokens: 10 } },
    ]);
    const { summary } = await buildPublicKeySummary(key.id);
    expect(summary.usage.totals.requests).toBe(2);
    expect(summary.usage.totals.totalTokens).toBe(180);
    expect(summary.usage.byModel.map((m) => m.model)).toEqual(["gpt-5.5", "gpt-5.4"]);
    expect(summary.usage.byProvider.map((p) => p.provider)).toEqual(["openai"]);
    expect(summary.usage.daily.length).toBe(1);
    expect(summary.usage.daily[0].tokens).toBe(180);
  });

  it("returns zeroed totals for a key with no traffic", async () => {
    const key = await makeKey("empty-usage", { publicShare: true });
    const { summary } = await buildPublicKeySummary(key.id);
    expect(summary.usage.totals.requests).toBe(0);
    expect(summary.usage.totals.totalTokens).toBe(0);
    expect(summary.usage.daily).toEqual([]);
    expect(summary.usage.byModel).toEqual([]);
    expect(summary.usage.byProvider).toEqual([]);
  });
});

describe("keyAccessContextFromRecord", () => {
  it("returns null for unrestricted and missing records", () => {
    expect(keyAccess.keyAccessContextFromRecord(null)).toBeNull();
    expect(keyAccess.keyAccessContextFromRecord(undefined)).toBeNull();
    expect(keyAccess.keyAccessContextFromRecord({ id: "k", access: { restricted: false, allow: [] } })).toBeNull();
    expect(keyAccess.keyAccessContextFromRecord({ id: "k" })).toBeNull();
  });

  it("builds the same context getKeyAccessContext builds from a request", async () => {
    const key = await makeKey("ctx", { access: { restricted: true, allow: ["openai/gpt-5.5"] } });
    const record = await db.getApiKeyById(key.id);
    const fromRecord = keyAccess.keyAccessContextFromRecord(record);
    const fromRequest = await keyAccess.getKeyAccessContext(new Request("http://localhost/v1/models", {
      headers: { Authorization: `Bearer ${key.key}` },
    }));
    expect(fromRecord).toEqual(fromRequest);
    expect(fromRecord).toEqual({
      keyId: key.id,
      keyName: "ctx",
      allow: ["openai/gpt-5.5"],
      _sets: null,
    });
  });

  it("still yields no context for a request with no key, an unknown key or an unrestricted key", async () => {
    const open = await makeKey("open", {});
    expect(await keyAccess.getKeyAccessContext(new Request("http://localhost/v1/models"))).toBeNull();
    expect(await keyAccess.getKeyAccessContext(new Request("http://localhost/v1/models", {
      headers: { Authorization: "Bearer sk-nope" },
    }))).toBeNull();
    expect(await keyAccess.getKeyAccessContext(new Request("http://localhost/v1/models", {
      headers: { Authorization: `Bearer ${open.key}` },
    }))).toBeNull();
  });
});
