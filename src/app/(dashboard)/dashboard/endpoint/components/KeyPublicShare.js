"use client";

// Per-key public status page sharing (/k/{id}).
//
// The link carries the key's id only, never the key, and anyone holding it can
// read that key's quota, expiry, models and usage until sharing is turned off.
// So: off by default, and when off no link is shown at all — a dead link in the
// dashboard invites someone to copy it.
import { useSyncExternalStore } from "react";
import PropTypes from "prop-types";
import { Toggle } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// Origin is client-only: reading window during render would desync SSR. The
// server snapshot is empty, so the link renders as a path until hydration.
const subscribe = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

export default function KeyPublicShare({ apiKey, onChange }) {
  const { copied, copy } = useCopyToClipboard();
  const origin = useSyncExternalStore(subscribe, getOrigin, getServerOrigin);
  const enabled = apiKey.publicShare === true;

  const url = origin ? `${origin}/k/${apiKey.id}` : `/k/${apiKey.id}`;

  return (
    <div className="flex flex-col gap-1.5">
      <Toggle
        size="sm"
        checked={enabled}
        label="Share status"
        onChange={(checked) => onChange(checked)}
      />
      {enabled ? (
        <>
          <div className="flex items-center gap-1">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="max-w-[140px] truncate font-mono text-[11px] text-primary hover:underline"
              title={url}
            >
              {url}
            </a>
            <button
              type="button"
              onClick={() => copy(url, apiKey.id)}
              title="Copy status link"
              className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
            >
              <span className="material-symbols-outlined text-[14px]">
                {copied === apiKey.id ? "check" : "content_copy"}
              </span>
            </button>
          </div>
          <p className="max-w-[170px] text-[11px] text-amber-600 dark:text-amber-400">
            Anyone with this link can view this key&apos;s quota, expiry, models and usage. Turn it off to revoke
            instantly.
          </p>
        </>
      ) : (
        <p className="text-[11px] text-text-muted">Link off — only you can see this key&apos;s status.</p>
      )}
    </div>
  );
}

KeyPublicShare.propTypes = {
  apiKey: PropTypes.shape({
    id: PropTypes.string.isRequired,
    publicShare: PropTypes.bool,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
};
