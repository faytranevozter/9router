// In-memory per-visitor/per-key progressive lockout; resets on process restart.
import { getClientIp } from "./loginLimiter.js";

const MAX_FAILS_BEFORE_LOCK = 5;
const LOCK_STEPS_MS = [30_000, 120_000, 600_000, 1_800_000];
const FAIL_WINDOW_MS = 60 * 60 * 1000;
const attempts = new Map();
const bucket = (request, keyId) => `${getClientIp(request)}:${keyId}`;
function entryFor(id) {
  const entry = attempts.get(id);
  if (entry?.lastFailAt && Date.now() - entry.lastFailAt > FAIL_WINDOW_MS && Date.now() >= entry.lockUntil) {
    attempts.delete(id);
    return null;
  }
  return entry || null;
}
export function checkLock(request, keyId) {
  const entry = entryFor(bucket(request, keyId));
  const remaining = (entry?.lockUntil || 0) - Date.now();
  return remaining > 0 ? { locked: true, retryAfter: Math.ceil(remaining / 1000) } : { locked: false };
}
export function recordFail(request, keyId) {
  const id = bucket(request, keyId);
  const entry = entryFor(id) || { fails: 0, lockUntil: 0, lockLevel: 0 };
  entry.fails += 1;
  entry.lastFailAt = Date.now();
  if (entry.fails >= MAX_FAILS_BEFORE_LOCK) {
    entry.lockUntil = Date.now() + LOCK_STEPS_MS[Math.min(entry.lockLevel, LOCK_STEPS_MS.length - 1)];
    entry.lockLevel += 1;
    entry.fails = 0;
  }
  attempts.set(id, entry);
  return { remainingBeforeLock: MAX_FAILS_BEFORE_LOCK - entry.fails };
}
export function recordSuccess(request, keyId) { attempts.delete(bucket(request, keyId)); }
