// Require a complete ISO timestamp and explicit timezone; Date.parse alone
// accepts ambiguous dates and silently rolls invalid calendar dates forward.
function expirationTime(value) {
  if (typeof value !== "string") return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second, , zone] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (+month < 1 || +month > 12 || +day < 1 || +day > days || +hour > 23 || +minute > 59 || +second > 59) return NaN;
  if (zone !== "Z" && (+zone.slice(1, 3) > 23 || +zone.slice(4, 6) > 59)) return NaN;
  return Date.parse(value);
}

export function validateKeyExpiration(value, now = Date.now()) {
  if (value === null) return { ok: true, value: null };
  const time = expirationTime(value);
  if (!Number.isFinite(time)) {
    return { ok: false, error: "Expiration must be a valid ISO timestamp with a timezone, or null for Never" };
  }
  if (time <= now) return { ok: false, error: "Expiration must be in the future" };
  return { ok: true, value: new Date(time).toISOString() };
}

export function isKeyExpired(expiresAt, now = Date.now()) {
  if (expiresAt === null || expiresAt === undefined) return false;
  const time = expirationTime(expiresAt);
  // Fail closed for corrupt stored values, never treat them as unlimited.
  return !Number.isFinite(time) || time <= now;
}

export function isKeyUsable(key, now = Date.now()) {
  return key.isActive !== false && !isKeyExpired(key.expiresAt, now);
}

// datetime-local inputs represent local wall time, not UTC.
export function expirationToLocalInput(expiresAt) {
  if (!expiresAt || !Number.isFinite(expirationTime(expiresAt))) return "";
  const date = new Date(expiresAt);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function localInputToExpiration(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime()) || expirationToLocalInput(date.toISOString()) !== (value.length === 16 ? `${value}:00` : value)) {
    return { ok: false, error: "Choose a valid local date and time" };
  }
  return validateKeyExpiration(date.toISOString());
}
