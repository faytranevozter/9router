export const PUBLIC_PIN_MIN_LENGTH = 6;
export const PUBLIC_PIN_MAX_LENGTH = 12;

export function validatePublicPin(value) {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string" || !/^\d+$/.test(value) || value.length < PUBLIC_PIN_MIN_LENGTH || value.length > PUBLIC_PIN_MAX_LENGTH) {
    return { ok: false, error: "PIN must contain 6 to 12 digits" };
  }
  return { ok: true, value };
}
