// Custom upstream headers for provider nodes: shared validation, API
// persistence, node scoping, and forwarding on Chat Completions / Responses.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getProviderNodes: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => mocks.fetchMock(...args),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
  getProviderNodes: mocks.getProviderNodes,
  getModelAliases: vi.fn(async () => ({})),
  getComboByName: vi.fn(async () => null),
}));

const {
  MAX_HEADER_OVERRIDES,
  MAX_HEADER_OVERRIDE_VALUE_LENGTH,
  buildHeaderOverridesFromRows,
  mergeHeadersCaseInsensitive,
  normalizeHeaderOverrides,
} = await import("../../open-sse/utils/headerOverrides.js");
const { BaseExecutor } = await import("../../open-sse/executors/base.js");
const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
const { parseModel } = await import("../../open-sse/services/model.js");
const { getModelInfo } = await import("../../src/sse/services/model.js");
const { GET, PUT } = await import("../../src/app/api/providers/[id]/overrides/route.js");

const CHAT_NODE = "openai-compatible-chat-3d8d3de8-1206-47ee-a42f-22113a5f2387";
const RESPONSES_NODE = "openai-compatible-responses-11111111-2222-3333-4444-555555555555";
const BASE = "https://gateway.example.com/v1";

function jsonResponse(status = 200) {
  return { status, headers: { get: () => "" } };
}

function putRequest(id, body) {
  return new Request(`http://localhost/api/providers/${id}/overrides`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(id) {
  return new Request(`http://localhost/api/providers/${id}/overrides`);
}

const params = (id) => ({ params: Promise.resolve({ id }) });

let settingsStore;

beforeEach(() => {
  settingsStore = { providerOverrides: {} };
  mocks.fetchMock.mockReset();
  mocks.getSettings.mockImplementation(async () => settingsStore);
  mocks.updateSettings.mockImplementation(async (patch) => {
    settingsStore = { ...settingsStore, ...patch };
  });
  mocks.getProviderNodes.mockImplementation(async ({ type } = {}) => {
    if (type === "openai-compatible") {
      return [
        { id: CHAT_NODE, prefix: "htc", type: "openai-compatible" },
        { id: RESPONSES_NODE, prefix: "htr", type: "openai-compatible" },
      ];
    }
    return [];
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("normalizeHeaderOverrides", () => {
  it("keeps valid custom headers and drops empty values", () => {
    const { headers, error } = normalizeHeaderOverrides({
      "X-Tenant-ID": "team-a",
      "X-Empty": "",
    });
    expect(error).toBeUndefined();
    expect(headers).toEqual({ "X-Tenant-ID": "team-a" });
  });

  it("rejects case-insensitive duplicate names", () => {
    const { error } = normalizeHeaderOverrides({
      "X-Tenant-ID": "team-a",
      "x-tenant-id": "team-b",
    });
    expect(error).toMatch(/Duplicate header name/);
  });

  it("rejects blocked request/auth headers", () => {
    for (const name of ["Authorization", "authorization", "Content-Type", "Host", "Cookie"]) {
      expect(normalizeHeaderOverrides({ [name]: "x" }).error).toMatch(/cannot be overridden/);
    }
  });

  it("rejects malformed names and CR/LF values", () => {
    expect(normalizeHeaderOverrides({ "Bad Name": "x" }).error).toMatch(/Invalid header name/);
    expect(normalizeHeaderOverrides({ "X-Bad": "a\r\nInjected: 1" }).error).toMatch(/Invalid value/);
    expect(normalizeHeaderOverrides({ "X-Bad": "a\n" }).error).toMatch(/Invalid value/);
  });

  it("enforces value length and header count limits", () => {
    expect(normalizeHeaderOverrides({
      "X-Long": "a".repeat(MAX_HEADER_OVERRIDE_VALUE_LENGTH + 1),
    }).error).toMatch(/too long/);

    const tooMany = {};
    for (let i = 0; i <= MAX_HEADER_OVERRIDES; i += 1) tooMany[`X-H-${i}`] = "v";
    expect(normalizeHeaderOverrides(tooMany).error).toMatch(/Too many headers/);
  });

  it("never echoes header values in an error", () => {
    const secret = "super-secret-value";
    const { error } = normalizeHeaderOverrides({ "X-Bad": `${secret}\r\n` });
    expect(error).toBeTruthy();
    expect(error).not.toContain(secret);
  });
});

describe("mergeHeadersCaseInsensitive", () => {
  it("replaces a registry header rather than adding a differently cased duplicate", () => {
    const merged = mergeHeadersCaseInsensitive(
      { "X-Title": "default", "HTTP-Referer": "https://default" },
      { "x-title": "custom" },
    );
    expect(merged).toEqual({ "HTTP-Referer": "https://default", "x-title": "custom" });
    expect(Object.keys(merged).filter((key) => key.toLowerCase() === "x-title")).toHaveLength(1);
  });

  it("ignores empty override values", () => {
    expect(mergeHeadersCaseInsensitive({ "X-Title": "default" }, { "X-Title": "" }))
      .toEqual({ "X-Title": "default" });
  });
});

describe("buildHeaderOverridesFromRows (editor reset/clear)", () => {
  const builtin = { "HTTP-Referer": "https://default", "X-Title": "default" };

  it("emits no overrides after Reset restores registry defaults", () => {
    const rows = Object.entries(builtin).map(([name, value]) => ({ name, value }));
    expect(buildHeaderOverridesFromRows(rows, builtin)).toEqual({ headers: {} });
  });

  it("keeps edited values and drops unchanged defaults", () => {
    const rows = [
      { name: "HTTP-Referer", value: "https://default" },
      { name: "X-Title", value: "custom" },
      { name: "X-Tenant-ID", value: "team-a" },
    ];
    expect(buildHeaderOverridesFromRows(rows, builtin)).toEqual({
      headers: { "X-Title": "custom", "X-Tenant-ID": "team-a" },
    });
  });

  it("compares default values case-insensitively", () => {
    expect(buildHeaderOverridesFromRows([{ name: "x-title", value: "default" }], builtin))
      .toEqual({ headers: {} });
  });

  it("returns validation errors without echoing values", () => {
    expect(buildHeaderOverridesFromRows([
      { name: "X-Tenant-ID", value: "a" },
      { name: "x-tenant-id", value: "b" },
    ], {}).error).toMatch(/Duplicate header name/);
    expect(buildHeaderOverridesFromRows([{ name: "Authorization", value: "secret" }], {}).error)
      .toMatch(/cannot be overridden/);
  });
});

describe("overrides API", () => {
  it("returns saved overrides plus registry defaults for a node", async () => {
    settingsStore.providerOverrides[CHAT_NODE] = { headers: { "X-Tenant-ID": "team-a" } };

    const response = await GET(getRequest(CHAT_NODE), params(CHAT_NODE));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ headers: { "X-Tenant-ID": "team-a" }, builtinHeaders: {} });
  });

  it("saves a node override and returns the normalized state", async () => {
    const response = await PUT(putRequest(CHAT_NODE, { headers: { "X-Tenant-ID": "team-a", "X-Empty": "" } }), params(CHAT_NODE));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ headers: { "X-Tenant-ID": "team-a" }, builtinHeaders: {} });
    expect(settingsStore.providerOverrides[CHAT_NODE]).toEqual({ headers: { "X-Tenant-ID": "team-a" } });
  });

  it("keeps header configuration separate per compatible node", async () => {
    await PUT(putRequest(CHAT_NODE, { headers: { "X-Tenant-ID": "team-a" } }), params(CHAT_NODE));
    await PUT(putRequest(RESPONSES_NODE, { headers: { "X-Tenant-ID": "team-b" } }), params(RESPONSES_NODE));

    expect(settingsStore.providerOverrides[CHAT_NODE].headers["X-Tenant-ID"]).toBe("team-a");
    expect(settingsStore.providerOverrides[RESPONSES_NODE].headers["X-Tenant-ID"]).toBe("team-b");
  });

  it("clears the persisted override when the final header is removed", async () => {
    await PUT(putRequest(CHAT_NODE, { headers: { "X-Tenant-ID": "team-a" } }), params(CHAT_NODE));
    const response = await PUT(putRequest(CHAT_NODE, { headers: {} }), params(CHAT_NODE));
    const body = await response.json();

    expect(body.headers).toEqual({});
    expect(settingsStore.providerOverrides[CHAT_NODE]).toBeUndefined();

    const reloaded = await (await GET(getRequest(CHAT_NODE), params(CHAT_NODE))).json();
    expect(reloaded.headers).toEqual({});
  });

  it("enforces validation at the server boundary", async () => {
    for (const headers of [
      { "X-Tenant-ID": "a", "x-tenant-id": "b" },
      { Authorization: "Bearer client-key" },
      { "X-Bad": "a\r\nInjected: 1" },
      { "X-Long": "a".repeat(MAX_HEADER_OVERRIDE_VALUE_LENGTH + 1) },
    ]) {
      const response = await PUT(putRequest(CHAT_NODE, { headers }), params(CHAT_NODE));
      expect(response.status).toBe(400);
    }
    expect(settingsStore.providerOverrides[CHAT_NODE]).toBeUndefined();
  });
});

describe("provider id used for saving matches chat routing", () => {
  it("keeps the dynamic node id through model parsing", () => {
    expect(parseModel(`${CHAT_NODE}/my-model`).provider).toBe(CHAT_NODE);
    expect(parseModel(`${RESPONSES_NODE}/my-model`).provider).toBe(RESPONSES_NODE);
  });

  it("resolves a node prefix to the same id used by the provider page", async () => {
    expect(await getModelInfo("htc/my-model")).toEqual({ provider: CHAT_NODE, model: "my-model" });
    expect(await getModelInfo("htr/my-model")).toEqual({ provider: RESPONSES_NODE, model: "my-model" });
  });
});

describe("header forwarding", () => {
  it("merges overrides case-insensitively and keeps API-key auth", async () => {
    mocks.fetchMock.mockResolvedValueOnce(jsonResponse(200));
    const ex = new BaseExecutor("test", { baseUrl: "https://x/api", headers: { "X-Title": "default" } });

    const out = await ex.execute({
      model: "m",
      body: {},
      stream: false,
      credentials: { apiKey: "sk-test" },
      providerOverrides: { headers: { "x-title": "custom", "X-Tenant-ID": "team-a" } },
    });

    const [, options] = mocks.fetchMock.mock.calls[0];
    expect(out.headers["x-title"]).toBe("custom");
    expect(out.headers["X-Title"]).toBeUndefined();
    expect(out.headers["X-Tenant-ID"]).toBe("team-a");
    expect(options.headers.Authorization).toBe("Bearer sk-test");
    expect(out.headers.Authorization).toBe("Bearer sk-test");
  });

  it("applies one node's overrides to every connection on that node", async () => {
    mocks.fetchMock.mockResolvedValue(jsonResponse(200));
    const ex = new DefaultExecutor(CHAT_NODE);
    const providerOverrides = { headers: { "X-Tenant-ID": "team-a" } };

    for (const apiKey of ["connection-one", "connection-two"]) {
      await ex.execute({
        model: "m",
        body: { model: "m" },
        stream: false,
        credentials: { apiKey, providerSpecificData: { baseUrl: BASE, apiType: "chat" } },
        providerOverrides,
      });
    }

    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);
    for (const [index, apiKey] of ["connection-one", "connection-two"].entries()) {
      const [, options] = mocks.fetchMock.mock.calls[index];
      expect(options.headers["X-Tenant-ID"]).toBe("team-a");
      expect(options.headers.Authorization).toBe(`Bearer ${apiKey}`);
    }
  });

  for (const [node, apiType, path] of [
    [CHAT_NODE, "chat", "/chat/completions"],
    [RESPONSES_NODE, "responses", "/responses"],
  ]) {
    for (const stream of [true, false]) {
      it(`sends custom headers to ${apiType} (${stream ? "streaming" : "non-streaming"})`, async () => {
        mocks.fetchMock.mockResolvedValueOnce(jsonResponse(200));
        const ex = new DefaultExecutor(node);

        const out = await ex.execute({
          model: "m",
          body: { model: "m" },
          stream,
          credentials: {
            apiKey: "sk-test",
            providerSpecificData: { baseUrl: BASE, apiType },
          },
          providerOverrides: { headers: { "X-Tenant-ID": "team-a" } },
        });

        const [url, options] = mocks.fetchMock.mock.calls[0];
        expect(url).toBe(`${BASE}${path}`);
        expect(options.headers["X-Tenant-ID"]).toBe("team-a");
        expect(options.headers.Authorization).toBe("Bearer sk-test");
        expect(out.headers.Authorization).toBe("Bearer sk-test");
        if (stream) expect(options.headers.Accept).toBe("text/event-stream");
        else expect(options.headers.Accept).toBeUndefined();
      });
    }
  }
});
