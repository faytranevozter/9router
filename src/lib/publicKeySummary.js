// Public per-key status page: the single place that decides what is public.
//
// The page at /k/{keyId} renders exactly this payload and nothing else, so a
// field that is not built here cannot leak through the page by accident. The
// key's secret is never part of it: not the key, not keyMasked, not machineId,
// not the access allow list, and not USD cost (that is the operator's spend
// data, not the key holder's).
//
// The id is a bearer capability — a random uuid v4 (122 bits) — and sharing is
// opt-in per key. A key with sharing off must be INDISTINGUISHABLE from an id
// that does not exist, or the page becomes an oracle for which ids are real.
import { getApiKeyById } from "@/lib/db/repos/apiKeysRepo.js";
import { getApiKeyUsage } from "@/lib/db/repos/usageRepo.js";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import { keyAccessContextFromRecord, filterModelsListForKey } from "@/sse/services/keyAccess.js";
import { isKeyExpired } from "@/shared/utils/keyExpiration.js";

const DAY_MS = 86400000;
// LLM kind only for now. Widening to image/tts/embeddings is a change to this
// argument, not to the page.
const PUBLIC_MODEL_KINDS = ["llm"];
const USAGE_PERIOD = "7d";

// Provider names are public; connection ids, account emails and cost are not.
function stripCost(rows) {
  return (rows || []).map(({ cost, ...rest }) => rest);
}

// Capability flags only — the camelCase limits (contextWindow/maxOutput) are
// already published as context_length/max_completion_tokens, and the rest of
// the capabilities block is not worth the page weight.
function publicCapabilities(caps) {
  if (!caps || typeof caps !== "object") return undefined;
  const out = {};
  for (const [key, value] of Object.entries(caps)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function publicModel(entry) {
  const model = { id: entry.id, owned_by: entry.owned_by };
  if (Number.isFinite(entry.context_length)) model.context_length = entry.context_length;
  if (Number.isFinite(entry.max_completion_tokens)) model.max_completion_tokens = entry.max_completion_tokens;
  const capabilities = publicCapabilities(entry.capabilities);
  if (capabilities) model.capabilities = capabilities;
  return model;
}

function expiresInDays(expiresAt, now) {
  if (expiresAt == null) return null;
  const time = Date.parse(expiresAt);
  if (!Number.isFinite(time) || time <= now) return null;
  return Math.ceil((time - now) / DAY_MS);
}

function baseUrlFor(origin) {
  // NEXT_PUBLIC_BASE_URL wins when set (a deployment behind a proxy knows its
  // own public origin); otherwise the request's own origin.
  const configured = typeof process.env.NEXT_PUBLIC_BASE_URL === "string" ? process.env.NEXT_PUBLIC_BASE_URL.trim() : "";
  const root = (configured || origin || "").replace(/\/+$/, "");
  return root ? `${root}/v1` : "/v1";
}

/**
 * Projected quota exhaustion from the last 7 days of traffic.
 * An extrapolation, never a promise — the page labels it as one.
 * Null when unlimited, idle, or already exceeded.
 */
function buildProjection(usage, quota) {
  if (quota.unlimited || quota.exceeded) return null;
  const totalTokens = Number(usage?.totals?.totalTokens) || 0;
  if (totalTokens <= 0) return null;
  // Pace is measured over the days the key was actually used: dividing by a
  // fixed 7 would dilute a key that only runs a couple of days a week and
  // push its exhaustion date far past the truth.
  const sampleDays = Math.max(1, usage?.daily?.length || 0);
  const avgTokensPerDay = totalTokens / sampleDays;
  if (!(avgTokensPerDay > 0)) return null;
  const remaining = quota.remaining ?? 0;
  return {
    avgTokensPerDay: Math.round(avgTokensPerDay),
    projectedExhaustionAt: new Date(Date.now() + (remaining / avgTokensPerDay) * DAY_MS).toISOString(),
    sampleDays,
  };
}

/**
 * The public status payload for one key id.
 * @param {string} id - the key's uuid (never the key itself)
 * @param {{ origin?: string }} [options] - browser-facing origin for the endpoint example
 * @returns {Promise<{ found: false } | { found: true, summary: object }>}
 */
export async function buildPublicKeySummary(id, options = {}) {
  if (!id || typeof id !== "string") return { found: false };
  const record = await getApiKeyById(id);
  if (!record) return { found: false };
  // Sharing off is indistinguishable from "no such key".
  if (record.publicShare !== true) return { found: false };

  const now = Date.now();
  const tokenLimit = Number(record.tokenLimit) || 0;
  const usedTokens = Number(record.usedTokens) || 0;
  const unlimited = tokenLimit === 0;
  const remaining = unlimited ? null : Math.max(0, tokenLimit - usedTokens);
  const exceeded = !unlimited && usedTokens >= tokenLimit;
  const expired = isKeyExpired(record.expiresAt, now);
  const paused = record.isActive === false;

  // Same precedence checkApiKeyQuota evaluates in (pause, then expiry, then
  // quota), so the page and the request gate never disagree about why a key
  // is blocked.
  const status = paused ? "paused" : expired ? "expired" : exceeded ? "quota_exceeded" : "active";
  const usable = !paused && !expired && !exceeded;

  const quota = {
    tokenLimit,
    usedTokens,
    remaining,
    unlimited,
    percent: unlimited ? 0 : Math.min(100, (usedTokens / tokenLimit) * 100),
    exceeded,
    warning: !unlimited && !exceeded && usedTokens / tokenLimit >= 0.8,
  };

  const usage = await getApiKeyUsage(record.key, USAGE_PERIOD);

  // Only the models this key may call: the same filter /v1/models applies.
  const allModels = await buildModelsList(PUBLIC_MODEL_KINDS);
  const models = (await filterModelsListForKey(keyAccessContextFromRecord(record), allModels)).map(publicModel);

  return {
    found: true,
    summary: {
      key: {
        id: record.id,
        name: record.name || null,
        status,
        usable,
        createdAt: record.createdAt || null,
        expiresAt: record.expiresAt ?? null,
        expiresInDays: expiresInDays(record.expiresAt, now),
      },
      quota,
      projection: buildProjection(usage, quota),
      models,
      endpoint: {
        baseUrl: baseUrlFor(options.origin),
        chatPath: "/chat/completions",
        exampleModel: models.length ? models[0].id : null,
      },
      usage: {
        period: USAGE_PERIOD,
        totals: usage?.totals
          ? (({ cost, ...totals }) => totals)(usage.totals)
          : { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0, firstUsed: null, lastUsed: null },
        daily: stripCost(usage?.daily),
        byModel: stripCost(usage?.byModel),
        byProvider: stripCost(usage?.byProvider),
      },
    },
  };
}
