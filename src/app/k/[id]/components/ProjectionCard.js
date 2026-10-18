import PropTypes from "prop-types";
import { fmtTokens } from "@/shared/utils/formatTokens";
import LocalDateTime from "./LocalDateTime";

// One line: projected quota exhaustion at the last 7 days' pace.
// The summary builder returns null when unlimited, idle or already exceeded,
// so the caller omits the whole block in those cases.
export default function ProjectionCard({ projection }) {
  if (!projection) return null;
  const { avgTokensPerDay, projectedExhaustionAt, sampleDays } = projection;

  return (
    <section className="rounded-[14px] border border-border bg-surface-2/40 p-4">
      <p className="flex items-start gap-2 text-xs leading-relaxed text-text-muted">
        <span className="material-symbols-outlined text-[16px] text-primary">trending_up</span>
        <span>
          At the last 7 days&apos; pace (<strong className="tabular-nums text-text-main">{fmtTokens(avgTokensPerDay)}</strong>{" "}
          tokens/day, averaged over {sampleDays} active {sampleDays === 1 ? "day" : "days"}), this quota runs out around{" "}
          <strong className="text-text-main">
            <LocalDateTime iso={projectedExhaustionAt} fallback={projectedExhaustionAt.slice(0, 16).replace("T", " ")} />
          </strong>
          . This is an extrapolation, not a promise.
        </span>
      </p>
    </section>
  );
}

ProjectionCard.propTypes = {
  projection: PropTypes.shape({
    avgTokensPerDay: PropTypes.number.isRequired,
    projectedExhaustionAt: PropTypes.string.isRequired,
    sampleDays: PropTypes.number.isRequired,
  }),
};
