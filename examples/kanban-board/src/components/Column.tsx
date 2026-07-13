import { type DragEvent, useState } from "react";
import { useStore } from "stoic-store/react";
import type { Column as ColumnType } from "../data";
import { board, moveTask } from "../store";
import { TaskCard } from "./TaskCard";

export function Column({ column }: { column: ColumnType }) {
  // Each column subscribes to its own slice of the grouped map, so dragging a
  // task between two columns rerenders only those two.
  const tasks = useStore(board, (s) => s.tasksByColumn[column.id]);
  const [isOver, setIsOver] = useState(false);

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsOver(false);
    const id = event.dataTransfer.getData("text/plain");
    if (id) moveTask(id, column.id);
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault(); // required for the drop event to fire
    event.dataTransfer.dropEffect = "move";
  }

  return (
    <section className={isOver ? "column over" : "column"}>
      <header>
        <h2>{column.title}</h2>
        <span className="count">{tasks.length}</span>
      </header>

      {/* The drop target is the task list itself — a real list, so it carries a
          role screen readers understand even though it's also interactive. */}
      <ul
        className="tasks"
        aria-label={`${column.title} tasks`}
        onDragOver={onDragOver}
        onDragEnter={() => setIsOver(true)}
        onDragLeave={() => setIsOver(false)}
        onDrop={onDrop}
      >
        {tasks.map((task) => (
          <li key={task.id}>
            <TaskCard task={task} />
          </li>
        ))}
      </ul>
    </section>
  );
}
