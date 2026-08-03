import crypto from "crypto";

const API_KEY_SECRET = process.env.API_KEY_SECRET || "endpoint-proxy-api-key-secret";

const USER_TOKEN_PREFIX = "sk-user-";

/**
 * Generate 6-char random keyId
 */
function generateKeyId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateCrc(keyId) {
  return crypto
    .createHmac("sha256", API_KEY_SECRET)
    .update(`user-token:${keyId}`)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Generate a user API token.
 * Format: sk-user-{keyId}-{crc8}
 * Distinct from machine keys (sk-{machineId}-{keyId}-{crc}) so the existing
 * key parsers/validators treat them as invalid machine keys.
 * @returns {{ key: string, keyId: string }}
 */
export function generateUserToken() {
  const keyId = generateKeyId();
  const crc = generateCrc(keyId);
  return { key: `${USER_TOKEN_PREFIX}${keyId}-${crc}`, keyId };
}

/**
 * Check whether a presented key looks like a user token.
 * @param {string|null|undefined} apiKey
 * @returns {boolean}
 */
export function isUserToken(apiKey) {
  return typeof apiKey === "string" && apiKey.startsWith(USER_TOKEN_PREFIX);
}

/**
 * Verify a user token's CRC. Return true when the shape + checksum hold.
 * @param {string} apiKey
 * @returns {boolean}
 */
export function verifyUserTokenCrc(apiKey) {
  if (!isUserToken(apiKey)) return false;
  const rest = apiKey.slice(USER_TOKEN_PREFIX.length);
  const parts = rest.split("-");
  if (parts.length !== 2) return false;
  const [keyId, crc] = parts;
  if (!keyId || !crc) return false;
  return crc === generateCrc(keyId);
}
