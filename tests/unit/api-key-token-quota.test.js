// Per-API-key token quotas: the checkApiKeyQuota gate (allow, over-limit 429,
// paused 401, tokenLimit=0 unlimited, known-key gating under requireApiKey=false)
// and the usedTokens counter incremented from saveRequestUsage.
//
// Runs against a real temp SQLite DB (initDb) so the additive schema columns,
// the repo round-trip and the usage counter all execute for real.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: async () => "machine-1",
}));

let tempDir;
let db;
let checkApiKeyQuota;

const originalDataDir = process.env.DATA_DIR;

// The apiKeys DDL as it was before the token-quota columns: schemaVersion 1.
function writeLegacyDb(dir) {
  fs.mkdirSync(path.join(dir, "db"), { recursive: true });
  const legacy = new DatabaseSync(path.join(dir, "db", "data.sqlite"));
  legacy.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  legacy.exec(`INSERT INTO _meta(key, value) VALUES ('schemaVersion', '1'), ('backupSchemaVersion', '1')`);
  legacy.exec(`CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1, createdAt TEXT NOT NULL)`);
  const ins = legacy.prepare(`INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?)`);
  ins.run("k1", "sk-legacy-one", "Default Key", "m", 1, "2026-09-01T00:00:00.000Z");
  legacy.close();
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-token-quota-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  ({ checkApiKeyQuota } = await import("../../src/sse/services/auth.js"));
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function makeKey(name, tokenLimit) {
  const created = await db.createApiKey(name, "machine-1", { tokenLimit });
  return created;
}

describe("apiKeys token-quota columns: additive sync onto an existing DB", () => {
  it("adds tokenLimit/usedTokens and reads every existing row as 0", async () => {
    // Fresh temp dir is empty; drop the DB the beforeEach boot created and
    // start from the legacy schema instead.
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    fs.rmSync(path.join(tempDir, "db"), { recursive: true, force: true });
    writeLegacyDb(tempDir);

    vi.resetModules();
    const fresh = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    await fresh.initDb();

    const cols = adapter.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["tokenLimit", "usedTokens"]));

    const key = await fresh.getApiKeyByKey("sk-legacy-one");
    expect(key.tokenLimit).toBe(0);
    expect(key.usedTokens).toBe(0);
  });
});

describe("checkApiKeyQuota gate", () => {
  it("passes missing/unknown keys when keys are not required (local mode)", async () => {
    expect(await checkApiKeyQuota(null, false)).toBeNull();
    expect(await checkApiKeyQuota("sk-unknown", false)).toBeNull();
  });

  it("rejects missing/unknown keys when requireApiKey is on", async () => {
    expect((await checkApiKeyQuota(null, true)).status).toBe(401);
    expect((await checkApiKeyQuota("sk-unknown", true)).status).toBe(401);
  });

  it("passes a healthy key within quota", async () => {
    const key = await makeKey("healthy", 1000);
    expect(await checkApiKeyQuota(key.key, false)).toBeNull();
    expect(await checkApiKeyQuota(key.key, true)).toBeNull();
  });

  it("treats tokenLimit=0 as unlimited", async () => {
    const key = await makeKey("unlimited", 0);
    // Push a lot of usage through: still allowed.
    await db.updateApiKey(key.id, { usedTokens: 5_000_000 });
    expect(await checkApiKeyQuota(key.key, false)).toBeNull();
    expect(await checkApiKeyQuota(key.key, true)).toBeNull();
  });

  it("returns 429 with a used / limit message once the quota is reached", async () => {
    const key = await makeKey("quota", 1000);
    await db.updateApiKey(key.id, { usedTokens: 1000 });
    const r = await checkApiKeyQuota(key.key, false);
    expect(r.status).toBe(429);
    expect(r.error).toContain("Token limit exceeded");
    expect(r.error).toContain("1,000");
  });

  it("returns 429 past the limit too", async () => {
    const key = await makeKey("over", 100);
    await db.updateApiKey(key.id, { usedTokens: 150 });
    expect((await checkApiKeyQuota(key.key, false)).status).toBe(429);
  });

  it("rejects a paused key with 401 even in local mode (requireApiKey=false)", async () => {
    const key = await makeKey("paused", 0);
    await db.updateApiKey(key.id, { isActive: false });
    const r = await checkApiKeyQuota(key.key, false);
    expect(r.status).toBe(401);
    expect(r.error).toContain("paused");
  });

  it("a KNOWN key is subject to its limit regardless of requireApiKey", async () => {
    const key = await makeKey("gated", 10);
    await db.updateApiKey(key.id, { usedTokens: 10 });
    // Same 429 whether keys are required or not.
    expect((await checkApiKeyQuota(key.key, false)).status).toBe(429);
    expect((await checkApiKeyQuota(key.key, true)).status).toBe(429);
  });
});

describe("usedTokens counter", () => {
  it("increments by prompt + completion tokens attributed to the key", async () => {
    const key = await makeKey("counter", 0);
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      connectionId: "c1",
      apiKey: key.key,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      endpoint: "/v1/chat/completions",
      status: "ok",
    });
    expect((await db.getApiKeyByKey(key.key)).usedTokens).toBe(15);

    // A second request with a distinct timestamp adds again.
    await db.saveRequestUsage({
      timestamp: new Date(Date.now() + 1000).toISOString(),
      provider: "openai",
      model: "gpt-4",
      connectionId: "c1",
      apiKey: key.key,
      tokens: { prompt_tokens: 20, completion_tokens: 10 },
      endpoint: "/v1/chat/completions",
      status: "ok",
    });
    expect((await db.getApiKeyByKey(key.key)).usedTokens).toBe(45);
  });

  it("adds nothing for a token-less entry", async () => {
    const key = await makeKey("tokenless", 0);
    await db.saveRequestUsage({
      provider: "tavily",
      model: "tavily",
      connectionId: "c1",
      apiKey: key.key,
      tokens: {},
      endpoint: "/v1/search",
      status: "ok",
    });
    expect((await db.getApiKeyByKey(key.key)).usedTokens).toBe(0);
  });

  it("counts only the entry's own key", async () => {
    const a = await makeKey("a", 0);
    const b = await makeKey("b", 0);
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      connectionId: "c1",
      apiKey: a.key,
      tokens: { prompt_tokens: 7, completion_tokens: 3 },
      endpoint: "/v1/chat/completions",
      status: "ok",
    });
    expect((await db.getApiKeyByKey(a.key)).usedTokens).toBe(10);
    expect((await db.getApiKeyByKey(b.key)).usedTokens).toBe(0);
  });

  it("stops serving the key once saveRequestUsage has spent the budget", async () => {
    const key = await makeKey("budget", 10);
    expect(await checkApiKeyQuota(key.key, false)).toBeNull();
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      connectionId: "c1",
      apiKey: key.key,
      tokens: { prompt_tokens: 6, completion_tokens: 6 },
      endpoint: "/v1/chat/completions",
      status: "ok",
    });
    expect((await checkApiKeyQuota(key.key, false)).status).toBe(429);
  });
});

describe("/api/keys routes carry the token-quota fields", () => {
  it("POST /api/keys creates a key with tokenLimit and usedTokens=0", async () => {
    const { POST } = await import("../../src/app/api/keys/route.js");
    const res = await POST(new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "route-key", tokenLimit: 5000 }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tokenLimit).toBe(5000);
    expect(body.usedTokens).toBe(0);
    expect((await db.getApiKeyByKey(body.key)).tokenLimit).toBe(5000);
  });

  it("GET /api/keys lists tokenLimit/usedTokens per key", async () => {
    const key = await makeKey("listed", 1234);
    await db.updateApiKey(key.id, { usedTokens: 12 });
    const { GET } = await import("../../src/app/api/keys/route.js");
    const body = await (await GET()).json();
    const found = body.keys.find((k) => k.id === key.id);
    expect(found.tokenLimit).toBe(1234);
    expect(found.usedTokens).toBe(12);
  });

  it("PUT /api/keys/[id] accepts tokenLimit and usedTokens", async () => {
    const key = await makeKey("editable", 0);
    const { PUT } = await import("../../src/app/api/keys/[id]/route.js");
    const res = await PUT(new Request(`http://localhost/api/keys/${key.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenLimit: 100, usedTokens: 40 }),
    }), { params: Promise.resolve({ id: key.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key.tokenLimit).toBe(100);
    expect(body.key.usedTokens).toBe(40);
    // Persisted.
    const stored = await db.getApiKeyById(key.id);
    expect(stored.tokenLimit).toBe(100);
    expect(stored.usedTokens).toBe(40);
  });

  it("PUT resets the counter to 0 and then the key is allowed again", async () => {
    const key = await makeKey("reset", 10);
    await db.updateApiKey(key.id, { usedTokens: 10 });
    expect((await checkApiKeyQuota(key.key, false)).status).toBe(429);
    const { PUT } = await import("../../src/app/api/keys/[id]/route.js");
    await PUT(new Request(`http://localhost/api/keys/${key.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usedTokens: 0 }),
    }), { params: Promise.resolve({ id: key.id }) });
    expect(await checkApiKeyQuota(key.key, false)).toBeNull();
  });
});

describe("GET /api/keys/[id]/usage detailed quota", () => {
  async function seedUsage(key, entries) {
    let i = 0;
    for (const e of entries) {
      await db.saveRequestUsage({
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        provider: e.provider || "openai",
        model: e.model || "gpt-4",
        connectionId: "c1",
        apiKey: key.key,
        tokens: e.tokens,
        endpoint: e.endpoint || "/v1/chat/completions",
        status: "ok",
      });
      i++;
    }
  }

  it("reports quota, totals and breakdowns for a key", async () => {
    const key = await makeKey("detailed", 1000);
    await seedUsage(key, [
      { model: "gpt-4", provider: "openai", tokens: { prompt_tokens: 100, completion_tokens: 50 }, endpoint: "/v1/chat/completions" },
      { model: "gpt-4o", provider: "openai", tokens: { prompt_tokens: 20, completion_tokens: 10 }, endpoint: "/v1/embeddings" },
    ]);

    const { GET } = await import("../../src/app/api/keys/[id]/usage/route.js");
    const res = await GET(new Request(`http://localhost/api/keys/${key.id}/usage?period=all`), {
      params: Promise.resolve({ id: key.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Quota comes from the key row's gate counter (100+50+20+10 = 180).
    expect(body.quota.tokenLimit).toBe(1000);
    expect(body.quota.usedTokens).toBe(180);
    expect(body.quota.remaining).toBe(820);
    expect(body.quota.unlimited).toBe(false);
    expect(body.quota.exceeded).toBe(false);

    expect(body.totals.requests).toBe(2);
    expect(body.totals.promptTokens).toBe(120);
    expect(body.totals.completionTokens).toBe(60);
    expect(body.totals.totalTokens).toBe(180);

    // By model: gpt-4 first (more tokens).
    expect(body.byModel.map((m) => m.model)).toEqual(["gpt-4", "gpt-4o"]);
    expect(body.byProvider.map((p) => p.provider)).toEqual(["openai"]);
    // By endpoint: sorted by request count.
    expect(body.byEndpoint.map((e) => e.endpoint).sort()).toEqual(["/v1/chat/completions", "/v1/embeddings"]);
    expect(body.daily.length).toBeGreaterThanOrEqual(1);
    expect(body.daily[0].tokens).toBe(180);

    // Key is masked, never returned raw.
    expect(body.key.keyMasked).not.toBe(key.key);
    expect(body.key.name).toBe("detailed");
  });

  it("marks an unlimited key (tokenLimit=0) and an exceeded key correctly", async () => {
    const unlimited = await makeKey("unlim", 0);
    await seedUsage(unlimited, [{ tokens: { prompt_tokens: 5, completion_tokens: 5 } }]);
    const { GET } = await import("../../src/app/api/keys/[id]/usage/route.js");
    let body = await (await GET(new Request(`http://localhost/api/keys/${unlimited.id}/usage`), { params: Promise.resolve({ id: unlimited.id }) })).json();
    expect(body.quota.unlimited).toBe(true);
    expect(body.quota.remaining).toBeNull();
    expect(body.quota.exceeded).toBe(false);

    const capped = await makeKey("capped", 100);
    await seedUsage(capped, [{ tokens: { prompt_tokens: 60, completion_tokens: 60 } }]);
    body = await (await GET(new Request(`http://localhost/api/keys/${capped.id}/usage`), { params: Promise.resolve({ id: capped.id }) })).json();
    expect(body.quota.exceeded).toBe(true);
    expect(body.quota.percent).toBe(100);
    expect(body.quota.remaining).toBe(0);
  });

  it("scopes totals to the requested period", async () => {
    const key = await makeKey("periodic", 0);
    // One old entry (10 days ago) and one now.
    await db.saveRequestUsage({
      timestamp: new Date(Date.now() - 10 * 86400000).toISOString(),
      provider: "openai", model: "gpt-4", connectionId: "c1", apiKey: key.key,
      tokens: { prompt_tokens: 1000, completion_tokens: 0 }, endpoint: "/v1/chat/completions", status: "ok",
    });
    await db.saveRequestUsage({
      timestamp: new Date().toISOString(),
      provider: "openai", model: "gpt-4", connectionId: "c1", apiKey: key.key,
      tokens: { prompt_tokens: 7, completion_tokens: 3 }, endpoint: "/v1/chat/completions", status: "ok",
    });

    const { GET } = await import("../../src/app/api/keys/[id]/usage/route.js");
    const all = await (await GET(new Request(`http://localhost/api/keys/${key.id}/usage?period=all`), { params: Promise.resolve({ id: key.id }) })).json();
    expect(all.totals.totalTokens).toBe(1010);
    const week = await (await GET(new Request(`http://localhost/api/keys/${key.id}/usage?period=7d`), { params: Promise.resolve({ id: key.id }) })).json();
    expect(week.totals.totalTokens).toBe(10);
  });

  it("404s for an unknown key and 400s for a bad period", async () => {
    const { GET } = await import("../../src/app/api/keys/[id]/usage/route.js");
    const missing = await GET(new Request("http://localhost/api/keys/nope/usage"), { params: Promise.resolve({ id: "nope" }) });
    expect(missing.status).toBe(404);

    const key = await makeKey("badperiod", 0);
    const bad = await GET(new Request(`http://localhost/api/keys/${key.id}/usage?period=year`), { params: Promise.resolve({ id: key.id }) });
    expect(bad.status).toBe(400);
  });
});
