// Role gating for /api/users/* routes: admin-only management, member self-service.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getCurrentUser: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => ({ type: "next" })),
    json: mocks.jsonResponse,
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let adminUser;
let memberUser;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-userapi-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  adminUser = await db.createUser({ username: "admin", passwordHash: "h", role: "admin", restrictions: {}, isActive: true });
  memberUser = await db.createUser({ username: "bob", passwordHash: "h", role: "member", restrictions: {}, isActive: true });
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function makeRequest(body = null, cookies = {}) {
  return {
    cookies: { get: (k) => (cookies[k] ? { value: cookies[k] } : undefined) },
    json: async () => body,
  };
}

function session(user) {
  mocks.getCurrentUser.mockResolvedValue(user);
}

describe("user management routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists users only for admins", async () => {
    const { GET } = await import("../../src/app/api/users/route.js");
    await db.createUser({ username: "carol", passwordHash: "h", role: "member", restrictions: {} });

    session(null);
    expect((await GET(makeRequest())).status).toBe(401);

    session(memberUser);
    expect((await GET(makeRequest())).status).toBe(403);

    session(adminUser);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const usernames = res.body.users.map((u) => u.username);
    expect(usernames).toContain("carol");
    // passwordHash never leaks
    for (const u of res.body.users) expect(u.passwordHash).toBeUndefined();
  });

  it("admin creates a member; duplicates are rejected", async () => {
    const { POST } = await import("../../src/app/api/users/route.js");
    session(memberUser);
    const forbidden = await POST(makeRequest({ username: "dave", password: "secret1" }));
    expect(forbidden.status).toBe(403);

    session(adminUser);
    const ok = await POST(makeRequest({ username: "dave", password: "secret1" }));
    expect(ok.status).toBe(201);
    expect(ok.body.user.username).toBe("dave");
    expect(ok.body.user.role).toBe("member");

    const dup = await POST(makeRequest({ username: "dave", password: "secret1" }));
    expect(dup.status).toBe(409);
  });

  it("admin cannot delete self or the last admin", async () => {
    const { DELETE } = await import("../../src/app/api/users/[id]/route.js");
    const admin = adminUser;
    session(admin);
    // self-delete blocked
    const self = await DELETE(makeRequest(), { params: Promise.resolve({ id: admin.id }) });
    expect(self.status).toBe(400);

    // last-admin demotion blocked via PUT
    const { PUT } = await import("../../src/app/api/users/[id]/route.js");
    const demote = await PUT(makeRequest({ role: "member" }), { params: Promise.resolve({ id: admin.id }) });
    expect(demote.status).toBe(400);
  });

  it("admin can reset a member's password and restrictions", async () => {
    const { PUT } = await import("../../src/app/api/users/[id]/route.js");
    const created = await db.createUser({ username: "erin", passwordHash: "h", role: "member", restrictions: {} });
    session(adminUser);
    const res = await PUT(
      makeRequest({ password: "newpass1", restrictions: { models: ["gpt-4o"], rateLimitPerMinute: 5 } }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(res.status).toBe(200);
    expect(res.body.user.restrictions.models).toEqual(["gpt-4o"]);
    expect(res.body.user.restrictions.rateLimitPerMinute).toBe(5);
  });

  it("members can create and manage their own tokens", async () => {
    const { POST } = await import("../../src/app/api/users/me/tokens/route.js");
    const member = memberUser;
    session(member);
    const res = await POST(makeRequest({ name: "cli", expiresInDays: 30 }));
    expect(res.status).toBe(201);
    expect(res.body.token.key.startsWith("sk-user-")).toBe(true);
    expect(res.body.token.expiresAt).toBeTruthy();

    const created = await db.getUserTokens(member.id);
    expect(created.length).toBe(1);

    const { DELETE } = await import("../../src/app/api/users/me/tokens/[tokenId]/route.js");
    const otherUser = await db.createUser({ username: "fran", passwordHash: "h", role: "member", restrictions: {} });
    const otherToken = await db.createUserToken(otherUser.id, {});
    const notMine = await DELETE(makeRequest(), { params: Promise.resolve({ tokenId: otherToken.id }) });
    expect(notMine.status).toBe(404);

    const mine = await DELETE(makeRequest(), { params: Promise.resolve({ tokenId: created[0].id }) });
    expect(mine.status).toBe(200);
  });

  it("members cannot read other users or their tokens", async () => {
    const other = await db.createUser({ username: "gina", passwordHash: "h", role: "member", restrictions: {} });
    const { GET } = await import("../../src/app/api/users/[id]/route.js");
    session(memberUser);
    expect((await GET(makeRequest(), { params: Promise.resolve({ id: other.id }) })).status).toBe(403);

    const { GET: getTokens } = await import("../../src/app/api/users/[id]/tokens/route.js");
    expect((await getTokens(makeRequest(), { params: Promise.resolve({ id: other.id }) })).status).toBe(403);
  });
});
