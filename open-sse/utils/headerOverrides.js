// Custom upstream header overrides — shared by the dashboard editor and the
// /api/providers/[id]/overrides route so client and server enforce the same
// limits and normalization. Pure JS: safe to import from a client component.

export const MAX_HEADER_OVERRIDES = 20;
export const MAX_HEADER_OVERRIDE_VALUE_LENGTH = 8192;

// RFC 7230 token subset: letters, digits, hyphen (no spaces, no unicode).
export const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/;

// Request-structure / auth headers a user override must never touch.
// Authorization always comes from the connection's API key.
export const BLOCKED_HEADER_NAMES = new Set([
  "host",
  "content-length",
  "content-type",
  "connection",
  "transfer-encoding",
  "authorization",
  "cookie",
]);

/** Case-insensitive header lookup. Returns undefined when absent. */
export function getHeaderValue(headers, name) {
  if (!headers || !name) return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/**
 * Layer override headers over built-ins without creating differently cased
 * duplicates: the override replaces any existing key with the same name
 * (case-insensitive) and keeps its own casing.
 */
export function mergeHeadersCaseInsensitive(baseHeaders = {}, overrides = {}) {
  const merged = { ...(baseHeaders || {}) };
  for (const [name, value] of Object.entries(overrides || {})) {
    if (value == null || value === "") continue;
    const lower = name.toLowerCase();
    for (const key of Object.keys(merged)) {
      if (key.toLowerCase() === lower) delete merged[key];
    }
    merged[name] = value;
  }
  return merged;
}

/**
 * Validate a single header entry. Returns an error message or null.
 * `name` must already be trimmed.
 */
export function validateHeaderEntry(name, value) {
  if (!HEADER_NAME_RE.test(name)) {
    return `Invalid header name: ${name}`;
  }
  if (typeof value !== "string" || /[\r\n]/.test(value)) {
    return `Invalid value for header ${name}`;
  }
  if (value.length > MAX_HEADER_OVERRIDE_VALUE_LENGTH) {
    return `Header ${name} value too long (max ${MAX_HEADER_OVERRIDE_VALUE_LENGTH})`;
  }
  if (BLOCKED_HEADER_NAMES.has(name.toLowerCase())) {
    return `Header ${name} cannot be overridden`;
  }
  return null;
}

/**
 * Build the override diff for editor rows: names whose value equals the
 * registry default are omitted, so Reset + Save clears user overrides.
 * Returns { headers, error } using the same validation as the API.
 */
export function buildHeaderOverridesFromRows(rows, builtinHeaders = {}) {
  const seen = new Set();
  const headers = {};
  for (const row of rows || []) {
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    const value = typeof row?.value === "string" ? row.value : "";
    if (!name) {
      if (value.trim()) return { error: "Header name is required" };
      continue;
    }
    const entryError = validateHeaderEntry(name, value);
    if (entryError) return { error: entryError };
    const lower = name.toLowerCase();
    if (seen.has(lower)) return { error: `Duplicate header name: ${name}` };
    seen.add(lower);
    if (value !== getHeaderValue(builtinHeaders, name)) headers[name] = value;
  }
  return normalizeHeaderOverrides(headers);
}

/**
 * Validate and normalize an override header map.
 * Empty values are dropped (existing behavior: they are not persisted).
 * Returns { headers, error }; headers is always a plain object on success.
 * Error text never includes header values (they may carry secrets).
 */
export function normalizeHeaderOverrides(headers) {
  if (headers === undefined || headers === null) return { headers: {} };
  if (typeof headers !== "object" || Array.isArray(headers)) {
    return { error: "headers must be an object" };
  }

  const entries = Object.entries(headers).filter(([, value]) => value !== "" && value != null);
  if (entries.length > MAX_HEADER_OVERRIDES) {
    return { error: `Too many headers (max ${MAX_HEADER_OVERRIDES})` };
  }

  const clean = {};
  const seen = new Set();
  for (const [name, value] of entries) {
    const entryError = validateHeaderEntry(name, value);
    if (entryError) return { error: entryError };
    const lower = name.toLowerCase();
    if (seen.has(lower)) {
      return { error: `Duplicate header name: ${name}` };
    }
    seen.add(lower);
    clean[name] = value;
  }

  return { headers: clean };
}
