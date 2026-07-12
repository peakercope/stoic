import { shallow } from "../../../../src/tools";
import { board } from "../store";

export function BoardStats() {
  const { completedCount, overdueCount, completionRate, total } = board.useStore(
    (s) => ({
      completedCount: s.completedCount,
      overdueCount: s.overdueCount,
      completionRate: s.completionRate,
      total: s.tasks.length,
    }),
    shallow,
  );

  const percent = Math.round(completionRate * 100);

  return (
    <div className="stats">
      <Stat label="Tasks" value={String(total)} />
      <Stat label="Completed" value={`${completedCount} / ${total}`} />
      <Stat
        label="Overdue"
        value={String(overdueCount)}
        tone={overdueCount > 0 ? "warn" : undefined}
      />

      <div
        className="progress"
        role="progressbar"
        aria-label="Completion"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="muted">{percent}% done</span>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="stat">
      <span className="muted">{label}</span>
      <strong className={tone === "warn" ? "warn" : undefined}>{value}</strong>
    </div>
  );
}
