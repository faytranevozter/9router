import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { generateUserToken } from "@/shared/utils/userToken.js";
import { getUserById } from "./usersRepo.js";

function rowToToken(row) {
  if (!row) return null;
  const token = {
    id: row.id,
    userId: row.userId,
    key: row.key,
    name: row.name,
    isActive: row.isActive === 1 || row.isActive === true,
    expiresAt: row.expiresAt || null,
    lastUsedAt: row.lastUsedAt || null,
    createdAt: row.createdAt,
  };
  // "marked expired" — an expired token keeps isActive=true (so renewing the
  // date re-validates it) but is flagged expired and rejected by the gateway.
  token.isExpired = isTokenExpired(token);
  return token;
}

function isTokenExpired(token) {
  if (!token.expiresAt) return false;
  const exp = new Date(token.expiresAt).getTime();
  return Number.isFinite(exp) && exp < Date.now();
}

export async function getUserTokens(userId) {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM userTokens WHERE userId = ? ORDER BY createdAt ASC`, [userId]);
  return rows.map(rowToToken);
}

export async function getUserTokenById(id) {
  const db = await getAdapter();
  return rowToToken(db.get(`SELECT * FROM userTokens WHERE id = ?`, [id]));
}

export async function getUserTokenByKey(key) {
  const db = await getAdapter();
  return rowToToken(db.get(`SELECT * FROM userTokens WHERE key = ?`, [key]));
}

/**
 * Create a token for a user.
 * @param {string} userId
 * @param {{ name?: string, expiresAt?: string|null }} opts - expiresAt is an ISO
 *   string, or null/omitted for a never-expiring token.
 * @returns {Promise<object>} the created token (key visible once)
 */
export async function createUserToken(userId, opts = {}) {
  const db = await getAdapter();
  const user = await getUserById(userId);
  if (!user) throw new Error("User not found");
  const { key } = generateUserToken();
  const token = {
    id: uuidv4(),
    userId,
    key,
    name: opts.name || null,
    isActive: true,
    expiresAt: opts.expiresAt || null,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO userTokens(id, userId, key, name, isActive, expiresAt, lastUsedAt, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [token.id, token.userId, token.key, token.name, 1, token.expiresAt, null, token.createdAt]
  );
  return token;
}

/**
 * Update a token (extend expiry, rename, toggle active).
 * @param {string} id
 * @param {{ name?: string, isActive?: boolean, expiresAt?: string|null, lastUsedAt?: string }} data
 */
export async function updateUserToken(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM userTokens WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToToken(row), ...data, id };
    db.run(
      `UPDATE userTokens SET name = ?, isActive = ?, expiresAt = ?, lastUsedAt = ? WHERE id = ?`,
      [
        merged.name || null,
        merged.isActive ? 1 : 0,
        merged.expiresAt || null,
        merged.lastUsedAt || null,
        id,
      ]
    );
    result = rowToToken({ ...row, ...merged, id });
  });
  return result;
}

export async function deleteUserToken(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM userTokens WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/**
 * Validate a presented user token. Returns the owning user + token when the
 * token is active, not expired, and the owning user is active. Otherwise null.
 * @param {string} key
 * @returns {Promise<{ user: object, token: object } | null>}
 */
export async function validateUserToken(key) {
  const token = await getUserTokenByKey(key);
  if (!token) return null;
  if (!token.isActive) return null;
  if (isTokenExpired(token)) return null;
  const user = await getUserById(token.userId);
  if (!user || user.isActive === false) return null;
  return { user, token };
}
