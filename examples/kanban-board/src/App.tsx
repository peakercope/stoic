import { AddTaskForm } from "./components/AddTaskForm";
import { BoardStats } from "./components/BoardStats";
import { Column } from "./components/Column";
import { FilterBar } from "./components/FilterBar";
import { columns } from "./data";

export function App() {
  return (
    <div className="page">
      <header className="masthead">
        <h1>Sprint board</h1>
        <p className="muted">
          Drag a task between columns. Every count, stat and column below is derived from a single
          flat list of tasks.
        </p>
      </header>

      <BoardStats />
      <AddTaskForm />
      <FilterBar />

      <div className="board">
        {columns.map((column) => (
          <Column key={column.id} column={column} />
        ))}
      </div>
    </div>
  );
}
