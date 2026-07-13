import { shallow } from "../../../../src/tools";
import { assignees, type Label, labels } from "../data";
import { board, setAssignee, setLabel, setSearch } from "../store";

export function FilterBar() {
  const { filter, visible, total } = board.useStore(
    (s) => ({
      filter: s.filter,
      visible: s.filteredTasks.length,
      total: s.tasks.length,
    }),
    shallow,
  );

  const isFiltered = visible !== total;

  // Three actions, one render. Without `batch` this would notify subscribers
  // three times and rerender every column three times.
  const clearFilters = () =>
    board.batch(() => {
      setSearch("");
      setAssignee(null);
      setLabel(null);
    });

  return (
    <div className="filters">
      <input
        value={filter.search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search tasks…"
        aria-label="Search tasks"
      />

      <select
        value={filter.assignee ?? ""}
        onChange={(event) => setAssignee(event.target.value || null)}
        aria-label="Filter by assignee"
      >
        <option value="">Everyone</option>
        {assignees.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      <select
        value={filter.label ?? ""}
        onChange={(event) => setLabel((event.target.value || null) as Label | null)}
        aria-label="Filter by label"
      >
        <option value="">All labels</option>
        {labels.map((label) => (
          <option key={label} value={label}>
            {label}
          </option>
        ))}
      </select>

      {isFiltered && (
        <>
          <span className="muted">
            {visible} of {total}
          </span>
          <button type="button" className="link" onClick={clearFilters}>
            Clear
          </button>
        </>
      )}
    </div>
  );
}
