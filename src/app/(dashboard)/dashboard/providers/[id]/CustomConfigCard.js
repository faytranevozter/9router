"use client";

import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Card, Badge } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import {
  buildHeaderOverridesFromRows,
  getHeaderValue,
  mergeHeadersCaseInsensitive,
} from "open-sse/utils/headerOverrides.js";

const BLANK_ROW = { name: "", value: "" };

function toRows(headers) {
  const rows = Object.entries(headers || {}).map(([name, value]) => ({ name, value }));
  return rows.length ? rows : [{ ...BLANK_ROW }];
}

export default function CustomConfigCard({ providerId, alwaysVisible = false }) {
  const notify = useNotificationStore();
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState([{ ...BLANK_ROW }]);
  const [builtin, setBuiltin] = useState({});
  const [hasOverride, setHasOverride] = useState(false);
  // Load status is keyed by provider so a stale result can never enable Save
  // for a different node (or for a card whose load failed).
  const [loadState, setLoadState] = useState({ providerId: null, status: "loading", error: "" });
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  const loading = loadState.providerId !== providerId || loadState.status === "loading";
  const loaded = loadState.providerId === providerId && loadState.status === "ready";
  const loadError = loadState.providerId === providerId && loadState.status === "error" ? loadState.error : "";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/providers/${providerId}/overrides`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const builtinHeaders = data?.builtinHeaders || {};
        const savedHeaders = data?.headers || {};
        // Effective set = registry built-ins with user overrides layered on top
        setBuiltin(builtinHeaders);
        setRows(toRows(mergeHeadersCaseInsensitive(builtinHeaders, savedHeaders)));
        setHasOverride(Object.keys(savedHeaders).length > 0);
        setLoadState({ providerId, status: "ready", error: "" });
      })
      .catch(() => {
        if (cancelled) return;
        // Do not fall back to a blank editor: saving it would wipe saved headers.
        setLoadState({
          providerId,
          status: "error",
          error: "Could not load saved headers. Reload before editing so existing settings are not overwritten.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, reloadKey]);

  const reload = () => {
    setLoadState({ providerId, status: "loading", error: "" });
    setReloadKey((value) => value + 1);
  };

  const setRow = (i, field, value) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  };

  const save = useCallback(async () => {
    if (!loaded) {
      notify.error("Custom headers are not loaded yet. Reload and try again.");
      return;
    }

    // Validate every row first, then diff against registry defaults. Only rows
    // differing from the default become overrides, so a code-side registry bump
    // still wins for everything the user left alone.
    const { headers: normalized, error } = buildHeaderOverridesFromRows(rows, builtin);
    if (error) {
      notify.error(error);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/providers/${providerId}/overrides`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headers: normalized }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        notify.error(err.error || "Failed to save custom headers");
        return;
      }
      const data = await res.json().catch(() => ({}));
      // Adopt the server's normalized state instead of the draft.
      const savedBuiltin = data?.builtinHeaders ?? builtin;
      const savedHeaders = data?.headers ?? normalized;
      setBuiltin(savedBuiltin);
      setRows(toRows(mergeHeadersCaseInsensitive(savedBuiltin, savedHeaders)));
      setHasOverride(Object.keys(savedHeaders).length > 0);
      notify.success(
        Object.keys(savedHeaders).length > 0
          ? "Custom headers saved"
          : "Custom header overrides cleared",
      );
    } catch {
      notify.error("Network error: custom headers were not saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [rows, builtin, loaded, providerId, notify]);

  const resetToBuiltin = () => {
    // Registry defaults only in the editor; persistence happens on Save.
    setRows(toRows(builtin));
  };

  // Registry headers or existing overrides make the card relevant everywhere.
  // OpenAI-compatible nodes opt in explicitly so a fresh node can add its first
  // header even though it has neither yet.
  if (!alwaysVisible && Object.keys(builtin).length === 0 && !hasOverride) return null;

  const disabled = saving || loading || !loaded;

  return (
    <Card padding="xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">tune</span>
          <span className="text-sm font-semibold">Custom Headers</span>
          {hasOverride && (
            <Badge variant="success" size="sm">Active</Badge>
          )}
        </div>
        <span className="material-symbols-outlined text-text-muted">
          {expanded ? "expand_less" : "expand_more"}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 border-t border-border pt-3">
          {loading ? (
            <p className="text-xs text-text-muted">Loading headers...</p>
          ) : loadError ? (
            <div className="flex flex-col gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-3">
              <p className="text-xs text-red-500">{loadError}</p>
              <button
                type="button"
                onClick={reload}
                className="flex w-fit items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                Reload headers
              </button>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs text-text-muted">
                These headers are sent upstream on every request and shared by all connections on this provider node.
                Authorization is set from the connection API key and cannot be overridden. Reset loads registry defaults
                into the editor; click Save to apply.
              </p>

              <div className="flex flex-col gap-2">
                {rows.map((row, i) => {
                  const trimmedName = row.name.trim();
                  const builtinValue = getHeaderValue(builtin, trimmedName);
                  const overridden = builtinValue !== undefined && row.value !== builtinValue;
                  return (
                    <div key={i} className="flex items-start gap-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          value={row.name}
                          onChange={(e) => setRow(i, "name", e.target.value)}
                          placeholder="Header-Name"
                          aria-label={`Header name ${i + 1}`}
                          spellCheck={false}
                          disabled={saving}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none disabled:opacity-50 sm:w-44"
                        />
                        <input
                          value={row.value}
                          onChange={(e) => setRow(i, "value", e.target.value)}
                          placeholder="Value"
                          aria-label={`Header value ${i + 1}`}
                          spellCheck={false}
                          disabled={saving}
                          title={overridden ? "Overridden" : builtinValue !== undefined ? "Registry default" : ""}
                          className={`min-w-0 w-full flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none disabled:opacity-50 ${
                            overridden ? "border-amber-400/60" : "border-border"
                          }`}
                        />
                      </div>
                      <button
                        type="button"
                        title="Remove header"
                        aria-label={`Remove header ${i + 1}`}
                        disabled={saving}
                        onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : [{ ...BLANK_ROW }]))}
                        className="mt-1.5 shrink-0 text-text-muted hover:text-red-500 disabled:opacity-50 sm:mt-0"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setRows((prev) => [...prev, { ...BLANK_ROW }])}
                  disabled={saving}
                  className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Add header
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={resetToBuiltin}
                    className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-black/[0.03] dark:hover:bg-white/[0.03] disabled:opacity-50"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={save}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

CustomConfigCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  // Show the card even when the provider has no registry headers or saved
  // overrides — required for fresh OpenAI-compatible nodes.
  alwaysVisible: PropTypes.bool,
};
