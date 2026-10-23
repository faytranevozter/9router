"use client";

// Per-key public status page sharing (/k/{id}).
//
// The link carries the key's id only, never the key, and anyone holding it can
// read that key's quota, expiry, models and usage until sharing is turned off.
// So: off by default, and when off no link is shown at all — a dead link in the
// dashboard invites someone to copy it.
import { useSyncExternalStore, useState } from "react";
import PropTypes from "prop-types";
import { Toggle } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// Origin is client-only: reading window during render would desync SSR. The
// server snapshot is empty, so the link renders as a path until hydration.
const subscribe = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

export default function KeyPublicShare({ apiKey, onChange, onSetPin, onRemovePin }) {
  const [pin, setPin] = useState("");
  const [pinEditorFor, setPinEditorFor] = useState(null);
  const [error, setError] = useState("");
  const [savingPin, setSavingPin] = useState(false);
  const { copied, copy } = useCopyToClipboard();
  const origin = useSyncExternalStore(subscribe, getOrigin, getServerOrigin);
  const enabled = apiKey.publicShare === true;
  const protectedByPin = apiKey.publicPinSet === true;

  const showPinEntry = enabled && pinEditorFor === apiKey.id;

  const url = origin ? `${origin}/k/${apiKey.id}` : `/k/${apiKey.id}`;
  const submitPin = async (event) => {
    event.preventDefault();
    setSavingPin(true);
    setError("");
    try {
      const result = await onSetPin(pin);
      if (result?.error) setError(result.error);
      else {
        setPin("");
        setPinEditorFor(null);
      }
    } catch {
      setError("Could not save the PIN. Try again.");
    } finally {
      setSavingPin(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-main">Share status</p>
          <p className="mt-0.5 text-[11px] text-text-muted">Let someone view this key&apos;s usage and availability.</p>
        </div>
        <Toggle size="sm" checked={enabled} label="Share status" onChange={onChange} />
      </div>
      {enabled ? (
        <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
          <div className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
            <span className="material-symbols-outlined shrink-0 text-[16px] text-text-muted">link</span>
            <a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs text-primary hover:underline" title={url}>{url}</a>
            <button type="button" onClick={() => copy(url, apiKey.id)} title="Copy status link" aria-label="Copy status link" className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-surface-3 hover:text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <span className="material-symbols-outlined text-[15px]">{copied === apiKey.id ? "check" : "content_copy"}</span>
              <span>{copied === apiKey.id ? "Copied" : "Copy"}</span>
            </button>
          </div>

          {protectedByPin && !showPinEntry ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/25 bg-success/5 px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs text-text-main">
                <span className="material-symbols-outlined text-[17px] text-success">lock</span>
                <span>PIN protection is on</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <button type="button" className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => { setError(""); setPinEditorFor(apiKey.id); }}>Change PIN</button>
                <button type="button" className="font-medium text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive" onClick={onRemovePin}>Remove</button>
              </div>
            </div>
          ) : showPinEntry ? (
            <form className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-2 p-3" onSubmit={submitPin}>
              <div>
                <label htmlFor={`public-pin-${apiKey.id}`} className="text-xs font-medium text-text-main">{protectedByPin ? "Choose a new PIN" : "Require a PIN"}</label>
                <p className="mt-0.5 text-[11px] text-text-muted">Use 6–12 digits. Share it separately from the link.</p>
              </div>
              <input id={`public-pin-${apiKey.id}`} type="password" inputMode="numeric" pattern="[0-9]{6,12}" maxLength={12} autoComplete="new-password" value={pin} onChange={(event) => setPin(event.target.value)} aria-invalid={!!error} aria-describedby={error ? `public-pin-error-${apiKey.id}` : undefined} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-muted outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
              {error && <p id={`public-pin-error-${apiKey.id}`} role="alert" className="text-xs text-destructive">{error}</p>}
              <div className="flex items-center justify-end gap-2">
                <button type="button" disabled={savingPin} className="rounded-md px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-3 hover:text-text-main disabled:opacity-50" onClick={() => { setPinEditorFor(null); setPin(""); setError(""); }}>Cancel</button>
                <button type="submit" disabled={savingPin || !pin} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{savingPin ? "Saving…" : protectedByPin ? "Save new PIN" : "Save PIN"}</button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-sm text-xs leading-relaxed text-warning">Anyone with this link can view the key&apos;s status.</p>
              <button type="button" className="self-start rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-main hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:self-auto" onClick={() => setPinEditorFor(apiKey.id)}>Require a PIN</button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-2 border-t border-border-subtle pt-3 text-xs leading-relaxed text-text-muted">
          <span className="material-symbols-outlined text-[16px]">visibility_off</span>
          <p>Sharing is off. Only you can see this key&apos;s status.</p>
        </div>
      )}
    </div>
  );
}

KeyPublicShare.propTypes = {
  apiKey: PropTypes.shape({
    id: PropTypes.string.isRequired,
    publicShare: PropTypes.bool,
    publicPinSet: PropTypes.bool,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  onSetPin: PropTypes.func.isRequired,
  onRemovePin: PropTypes.func.isRequired,
};
