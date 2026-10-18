"use client";

import { Input } from "@/shared/components";

export default function KeyExpirationField({ value, onChange, error }) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-text-muted font-medium">
        Expiration
        <select
          aria-label="Expiration"
          value={value === null ? "never" : "custom"}
          onChange={(event) => onChange(event.target.value === "never" ? null : "")}
          className="mt-1 block w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-text-main"
        >
          <option value="never">Never</option>
          <option value="custom">Custom date and time</option>
        </select>
      </label>
      {value !== null && <Input label="Expires at" type="datetime-local" step="1" value={value} onChange={(event) => onChange(event.target.value)} />}
      <p className="text-[11px] text-text-muted">Timezone: {timezone}. Expired keys cannot authorize new requests.</p>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
