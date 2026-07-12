import type { DragEvent } from "react";
import { DONE, type Task } from "../data";
import { deleteTask } from "../store";

const isOverdue = (task: Task): boolean =>
  task.columnId !== DONE && task.dueDate < new Date().toISOString().slice(0, 10);

const dueLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function TaskCard({ task }: { task: Task }) {
  function onDragStart(event: DragEvent<HTMLElement>) {
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <article className="task" draggable onDragStart={onDragStart}>
      <div className="task-head">
        <span className={`label label-${task.label}`}>{task.label}</span>
        <button
          type="button"
          className="delete"
          onClick={() => deleteTask(task.id)}
          aria-label={`Delete ${task.title}`}
        >
          ×
        </button>
      </div>

      <p className="task-title">{task.title}</p>

      <footer>
        <span className="muted">{task.assignee}</span>
        <span className={isOverdue(task) ? "due overdue" : "due muted"}>
          {isOverdue(task) ? "Overdue · " : ""}
          {dueLabel(task.dueDate)}
        </span>
      </footer>
    </article>
  );
}
