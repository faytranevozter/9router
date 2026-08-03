// Per-user access enforcement for the /v1/* gateway path.
// Applies only to user tokens (sk-user-...): expired/inactive tokens are
// rejected, then model/provider allow-lists, per-user rate limits, and
// per-user usage quotas are enforced. Machine keys + localhost requests keep
// their existing behavior untouched.
import { validateUserToken, getUserTokens } from "@/lib/localDb";
import { isUserToken } from "@/shared/utils/userToken.js";
import { getModelInfo } from "./model.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { getAdapter } from "@/lib/db/driver.js";

// In-memory per-user sliding-window rate limiter (per process).
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map(); // userId -> { windowStart, count }

function getRateBucket(userId, now = Date.now()) {
  let b = rateBuckets.get(userId);
  if (!b || now - b.windowStart >= RATE_WINDOW_MS) {
    b = { windowStart: now, count: 0 };
    rateBuckets.set(userId, b);
  }
  return b;
}

// Periodically drop stale buckets so the map doesn't grow forever.
if (!global.__userRatePrune && typeof setInterval === "function") {
  global.__userRatePrune = setInterval(() => {
    const now = Date.now();
    for (const [userId, b] of rateBuckets) {
      if (now - b.windowStart >= RATE_WINDOW_MS) rateBuckets.delete(userId);
    }
  }, RATE_WINDOW_MS);
  if (global.__userRatePrune.unref) global.__userRatePrune.unref();
}

/**
 * Load a user session from a presented API key.
 * @param {string|null} apiKey
 * @returns {Promise<{ok: true, user: object, token: object} | {ok: false, status: number, message: string}>}
 */
export async function loadUserFromToken(apiKey) {
  if (!apiKey || !isUserToken(apiKey)) return { ok: false, status: 401, message: "Invalid or expired API key" };
  const found = await validateUserToken(apiKey);
  if (!found) return { ok: false, status: 401, message: "Invalid or expired API key" };
  return { ok: true, user: found.user, token: found.token };
}

function toRegex(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function isModelAllowed(restrictions, model) {
  const list = restrictions?.models;
  if (!Array.isArray(list) || list.length === 0) return true;
  const target = String(model || "").trim();
  if (!target) return true;
  return list.some((p) => toRegex(p).test(target));
}

export function isProviderAllowed(restrictions, providerId) {
  const list = restrictions?.providers;
  if (!Array.isArray(list) || list.length === 0) return true;
  if (!providerId) return true;
  const target = resolveProviderId(providerId);
  return list.some((p) => {
    const norm = String(p).trim().toLowerCase();
    if (!norm) return false;
    return norm === target || resolveProviderId(norm) === target;
  });
}

/**
 * Filter an OpenAI-style models list down to what a user is allowed to use,
 * based on their model + provider allow-lists. Combos and model entries whose
 * provider or id is not allowed are dropped. Unrestricted users get everything.
 * @param {Array<{id: string, owned_by?: string}>} models
 * @param {object} restrictions
 * @returns {Array} allowed models
 */
export function filterModelsForUser(models, restrictions = {}) {
  const list = Array.isArray(models) ? models : [];
  if (!restrictions.models?.length && !restrictions.providers?.length) return list;
  return list.filter((m) => {
    const fullId = m.id || "";
    const slash = fullId.lastIndexOf("/");
    const bare = slash >= 0 ? fullId.slice(slash + 1) : fullId;
    const provider = m.owned_by ? resolveProviderId(m.owned_by) : null;
    if (!isProviderAllowed(restrictions, provider)) return false;
    return isModelAllowed(restrictions, fullId) || isModelAllowed(restrictions, bare);
  });
}

/**
 * Check model + provider allow-lists for a request. Combo requests check every
 * member model so a combo can't silently route around restrictions.
 * @param {object} user
 * @param {string} modelStr - the requested model (possibly a combo name)
 * @param {string[]|null} comboModels - expanded combo members, if any
 */
export async function checkModelAndProvider(user, modelStr, comboModels = null) {
  const restrictions = user?.restrictions || {};

  const members = Array.isArray(comboModels) && comboModels.length > 0 ? comboModels : [modelStr];
  for (const m of members) {
    if (m.includes("/")) {
      // provider/model form — verify against the provider allow-list directly.
      const [prov] = m.split("/");
      if (!isProviderAllowed(restrictions, prov)) {
        return { ok: false, status: 403, message: `Provider "${prov}" is not allowed for this user` };
      }
      const modelOnly = m.slice(m.indexOf("/") + 1);
      if (!isModelAllowed(restrictions, modelOnly)) {
        return { ok: false, status: 403, message: `Model "${modelOnly}" is not allowed for this user` };
      }
    } else {
      let info;
      try {
        info = await getModelInfo(m);
      } catch {
        info = null;
      }
      if (info?.provider && !isProviderAllowed(restrictions, info.provider)) {
        return { ok: false, status: 403, message: `Provider "${info.provider}" is not allowed for this user` };
      }
      if (!isModelAllowed(restrictions, info?.model || m)) {
        return { ok: false, status: 403, message: `Model "${m}" is not allowed for this user` };
      }
    }
  }
  return { ok: true };
}

/**
 * Check per-user rate limit (requests/minute). Counts this request if it passes.
 * @param {object} user
 * @returns {{ok: true} | {ok: false, status: number, message: string, retryAfter: number}}
 */
export function checkRateLimit(user) {
  const rps = user?.restrictions?.rateLimitPerMinute;
  if (!rps || typeof rps !== "number" || rps <= 0) return { ok: true };
  const now = Date.now();
  const bucket = getRateBucket(user.id, now);
  if (bucket.count >= rps) {
    const retryAfter = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - bucket.windowStart)) / 1000));
    return { ok: false, status: 429, message: "Rate limit exceeded", retryAfter };
  }
  bucket.count += 1;
  return { ok: true };
}

/**
 * Check per-user usage quota (current calendar month, aggregated across the
 * user's tokens) against usageHistory.
 * @param {object} user
 * @returns {{ok: true} | {ok: false, status: number, message: string}}
 */
export async function checkUsageQuota(user) {
  const quota = user?.restrictions?.quota;
  const maxRequests = quota?.monthlyRequests;
  const maxTokens = quota?.monthlyTokens;
  if (!maxRequests && !maxTokens) return { ok: true };

  const db = await getAdapter();
  const tokens = await getUserTokens(user.id);
  const keys = tokens.map((t) => t.key);
  if (keys.length === 0) return { ok: true };

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const params = [];
  const marks = keys.map(() => "?").join(",");
  params.push(...keys, monthStart);

  const row = db.get(
    `SELECT COUNT(*) as requests, COALESCE(SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)), 0) as tokens
     FROM usageHistory
     WHERE apiKey IN (${marks}) AND timestamp >= ?`,
    params
  );

  const usedRequests = row?.requests || 0;
  const usedTokens = row?.tokens || 0;
  if (maxRequests && usedRequests >= maxRequests) {
    return { ok: false, status: 429, message: "Monthly usage quota exceeded (requests)" };
  }
  if (maxTokens && usedTokens >= maxTokens) {
    return { ok: false, status: 429, message: "Monthly usage quota exceeded (tokens)" };
  }
  return { ok: true };
}

/**
 * Full gate for a chat request. Order: token validity → rate limit → quota →
 * model/provider allow-list.
 * @returns {Promise<{ok: true, user: object, token: object} | {ok: false, status: number, message: string}>}
 */
export async function enforceChatAccess(apiKey, modelStr, comboModels = null) {
  const session = await loadUserFromToken(apiKey);
  if (!session.ok) return session;

  const rate = checkRateLimit(session.user);
  if (!rate.ok) return rate;

  const quota = await checkUsageQuota(session.user);
  if (!quota.ok) return quota;

  const restrict = await checkModelAndProvider(session.user, modelStr, comboModels);
  if (!restrict.ok) return restrict;

  return session;
}
