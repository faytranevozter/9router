// Multi-user management: users (admin/member roles + per-user restrictions)
// and user-owned expiring API tokens. Additive only — safe on any DB state.
import { buildCreateTableSql } from "../schema.js";

const USERS_DDL = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  isActive INTEGER DEFAULT 1,
  restrictions TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
)`;

const USER_TOKENS_DDL = `CREATE TABLE IF NOT EXISTS userTokens (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  key TEXT UNIQUE NOT NULL,
  name TEXT,
  isActive INTEGER DEFAULT 1,
  expiresAt TEXT,
  lastUsedAt TEXT,
  createdAt TEXT NOT NULL
)`;

export default {
  version: 2,
  name: "users",
  up(db) {
    db.exec(USERS_DDL);
    db.exec(USER_TOKENS_DDL);
    db.exec("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_ut_user ON userTokens(userId)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_ut_key ON userTokens(key)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_uh_apikey ON usageHistory(apiKey)");
  },
};
