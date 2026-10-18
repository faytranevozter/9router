import PropTypes from "prop-types";

// Status pill for the public key page. Mirrors the dashboard's Active/Paused/
// Expired colours so the same state reads the same way in both places.
const STYLES = {
  active: { label: "Active", className: "bg-green-500/10 text-green-600 dark:text-green-400" },
  paused: { label: "Paused", className: "bg-orange-500/10 text-orange-500" },
  expired: { label: "Expired", className: "bg-red-500/10 text-red-500" },
  quota_exceeded: { label: "Quota exceeded", className: "bg-red-500/10 text-red-500" },
};

export default function StatusPill({ status }) {
  const style = STYLES[status] || STYLES.active;
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${style.className}`}>
      {style.label}
    </span>
  );
}

StatusPill.propTypes = {
  status: PropTypes.oneOf(["active", "paused", "expired", "quota_exceeded"]).isRequired,
};
