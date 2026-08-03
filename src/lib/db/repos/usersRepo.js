import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const ADMIN_ROLE = "admin";

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    isActive: row.isActive === 1 || row.isActive === true,
    restrictions: parseJson(row.restrictions, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getUsers() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM users ORDER BY createdAt ASC`);
  return rows.map(rowToUser);
}

export async function getUserById(id) {
  const db = await getAdapter();
  return rowToUser(db.get(`SELECT * FROM users WHERE id = ?`, [id]));
}

export async function getUserByUsername(username) {
  if (!username) return null;
  const db = await getAdapter();
  return rowToUser(db.get(`SELECT * FROM users WHERE username = ?`, [String(username).trim().toLowerCase()]));
}

// Auth-scoped lookups that include the passwordHash (never returned by rowToUser).
export async function getUserAuthById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT id, passwordHash, role, isActive FROM users WHERE id = ?`, [id]);
  if (!row) return null;
  return { id: row.id, passwordHash: row.passwordHash, role: row.role, isActive: row.isActive === 1 || row.isActive === true };
}

export async function getUserAuthByUsername(username) {
  if (!username) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT id, passwordHash, role, isActive FROM users WHERE username = ?`, [String(username).trim().toLowerCase()]);
  if (!row) return null;
  return { id: row.id, passwordHash: row.passwordHash, role: row.role, isActive: row.isActive === 1 || row.isActive === true };
}

export async function getAdminUser() {
  const db = await getAdapter();
  return rowToUser(db.get(`SELECT * FROM users WHERE role = ? ORDER BY createdAt ASC LIMIT 1`, [ADMIN_ROLE]));
}

export async function getUserCount() {
  const db = await getAdapter();
  return db.get(`SELECT COUNT(*) as c FROM users`)?.c ?? 0;
}

export async function createUser({ username, passwordHash, role = "member", restrictions = {}, isActive = true }) {
  if (!username || !passwordHash) throw new Error("username and passwordHash are required");
  const db = await getAdapter();
  const user = {
    id: uuidv4(),
    username: String(username).trim().toLowerCase(),
    passwordHash,
    role: role === ADMIN_ROLE ? ADMIN_ROLE : "member",
    restrictions: restrictions || {},
    isActive: isActive !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO users(id, username, passwordHash, role, isActive, restrictions, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id, user.username, user.passwordHash, user.role,
      user.isActive ? 1 : 0, stringifyJson(user.restrictions),
      user.createdAt, user.updatedAt,
    ]
  );
  return rowToUser({ ...user, isActive: user.isActive ? 1 : 0 });
}

export async function updateUser(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM users WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToUser(row), ...data, id };
    const restrictions = data.restrictions !== undefined ? (data.restrictions || {}) : merged.restrictions;
    const username = data.username !== undefined ? String(data.username).trim().toLowerCase() : merged.username;
    const passwordHash = data.passwordHash !== undefined ? data.passwordHash : row.passwordHash;
    merged.username = username;
    merged.passwordHash = passwordHash;
    merged.restrictions = restrictions;
    merged.updatedAt = new Date().toISOString();
    db.run(
      `UPDATE users SET username = ?, passwordHash = ?, role = ?, isActive = ?, restrictions = ?, updatedAt = ? WHERE id = ?`,
      [
        username, passwordHash,
        data.role !== undefined ? (data.role === ADMIN_ROLE ? ADMIN_ROLE : "member") : row.role,
        data.isActive !== undefined ? (data.isActive ? 1 : 0) : row.isActive,
        stringifyJson(restrictions),
        merged.updatedAt,
        id,
      ]
    );
    result = rowToUser({ ...row, ...merged, id });
  });
  return result;
}

export async function deleteUser(id) {
  const db = await getAdapter();
  const res = db.transaction(() => {
    db.run(`DELETE FROM userTokens WHERE userId = ?`, [id]);
    return db.run(`DELETE FROM users WHERE id = ?`, [id]);
  });
  return (res?.changes ?? 0) > 0;
}

/**
 * Ensure an admin user exists (bootstrap). Uses the provided password hash
 * (already a bcrypt hash) and a default username. Idempotent.
 * @returns {Promise<{id: string, username: string, role: string}>}
 */
export async function ensureAdminUser(passwordHash, username = "admin") {
  const existing = await getAdminUser();
  if (existing) return existing;
  if (!passwordHash) throw new Error("passwordHash is required to bootstrap admin user");
  const created = await createUser({ username, passwordHash, role: ADMIN_ROLE });
  return created;
}
