import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { keyAccessFromColumns, keyAccessToColumns } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";
import { isKeyExpired, validateKeyExpiration } from "@/shared/utils/keyExpiration.js";

function normalizeExpiration(value) {
  const checked = validateKeyExpiration(value);
  if (!checked.ok) throw new Error(checked.error);
  return checked.value;
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    tokenLimit: row.tokenLimit != null ? Number(row.tokenLimit) : 0,
    usedTokens: row.usedTokens != null ? Number(row.usedTokens) : 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || null,
    expiresAt: row.expiresAt ?? null,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
    publicShare: row.publicShare === 1 || row.publicShare === true,
    publicPinSet: typeof row.publicPinHash === "string" && row.publicPinHash.length > 0,
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

// Public status page secret reveal: intentionally isolated from rowToKey and
// ordinary key-list/API responses. Call only after the PIN gate has unlocked.
export async function getApiKeySecretForPublicStatus(id) {
  const db = await getAdapter();
  const row = db.get("SELECT key FROM apiKeys WHERE id = ? AND publicShare = 1", [id]);
  return typeof row?.key === "string" ? row.key : null;
}

// Used by the /v1 handlers to read the presented key's access settings.
export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const now = new Date().toISOString();
  const tokenLimit = options.tokenLimit != null ? Math.max(0, Number(options.tokenLimit) || 0) : 0;
  const access = options.access || KEY_ACCESS_UNRESTRICTED;
  const publicShare = options.publicShare === true;
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    tokenLimit,
    usedTokens: 0,
    expiresAt: options.expiresAt === undefined ? null : normalizeExpiration(options.expiresAt),
    createdAt: now,
    updatedAt: now,
    access,
    publicShare,
  };
  const cols = keyAccessToColumns(access);
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, tokenLimit, usedTokens, createdAt, updatedAt, accessRestricted, accessAllow, expiresAt, publicShare) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      1,
      apiKey.tokenLimit,
      0,
      apiKey.createdAt,
      apiKey.updatedAt,
      cols.accessRestricted,
      cols.accessAllow,
      apiKey.expiresAt,
      publicShare ? 1 : 0,
    ]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const expiration = data.expiresAt === undefined ? undefined : normalizeExpiration(data.expiresAt);
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToKey(row);
    const merged = { ...current, ...data, updatedAt: new Date().toISOString() };
    merged.expiresAt = expiration === undefined ? current.expiresAt : expiration;
    const tokenLimit = merged.tokenLimit != null ? Math.max(0, Number(merged.tokenLimit) || 0) : 0;
    const usedTokens = merged.usedTokens != null ? Math.max(0, Number(merged.usedTokens) || 0) : 0;
    const cols = keyAccessToColumns(merged.access || KEY_ACCESS_UNRESTRICTED);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, tokenLimit = ?, usedTokens = ?, updatedAt = ?, accessRestricted = ?, accessAllow = ?, expiresAt = ?, publicShare = ?, publicPinHash = ? WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.machineId,
        merged.isActive ? 1 : 0,
        tokenLimit,
        usedTokens,
        merged.updatedAt,
        cols.accessRestricted,
        cols.accessAllow,
        merged.expiresAt,
        merged.publicShare === true ? 1 : 0,
        data.publicPinHash === undefined ? row.publicPinHash ?? null : data.publicPinHash,
        id,
      ]
    );
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });
  return result;
}

export async function incrementKeyTokens(key, tokens) {
  if (!key || !tokens || tokens <= 0) return;
  const db = await getAdapter();
  db.run(`UPDATE apiKeys SET usedTokens = COALESCE(usedTokens, 0) + ? WHERE key = ?`, [tokens, key]);
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive, expiresAt FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return (row.isActive === 1 || row.isActive === true) && !isKeyExpired(row.expiresAt);
}
