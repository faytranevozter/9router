"use client";

// Renders an ISO timestamp in the VIEWER's locale and timezone.
//
// The page is a server component, so a server-side toLocaleString() would show
// the server's timezone — useless to whoever holds the link. useSyncExternalStore
// gives a server snapshot (the plain ISO fallback) and a client snapshot (the
// localized text), so the SSR output and the first client render agree and the
// viewer's timezone wins once hydrated.
import { useSyncExternalStore } from "react";
import PropTypes from "prop-types";

const subscribe = () => () => {};

function formatLocal(iso) {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${new Date(time).toLocaleString()} (${zone})`;
}

export default function LocalDateTime({ iso, fallback = "—" }) {
  const text = useSyncExternalStore(
    subscribe,
    () => formatLocal(iso) ?? fallback,
    () => fallback
  );
  return <span suppressHydrationWarning>{text}</span>;
}

LocalDateTime.propTypes = {
  iso: PropTypes.string,
  fallback: PropTypes.string,
};
