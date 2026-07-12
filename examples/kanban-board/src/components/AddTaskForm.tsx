import { type FormEvent, useState } from "react";
import { assignees, type Label, labels } from "../data";
import { addTask } from "../store";

const inTwoWeeks = (): string => {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
};

export function AddTaskForm() {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState(assignees[0] as string);
  const [label, setLabel] = useState<Label>("feature");
  const [dueDate, setDueDate] = useState(inTwoWeeks);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;

    addTask({ title: title.trim(), assignee, label, dueDate, columnId: "backlog" });
    setTitle("");
  }

  return (
    <form className="add-task" onSubmit={onSubmit}>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="New task…"
        aria-label="Task title"
      />

      <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assignee">
        {assignees.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      <select
        value={label}
        onChange={(event) => setLabel(event.target.value as Label)}
        aria-label="Label"
      >
        {labels.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>

      <input
        type="date"
        value={dueDate}
        onChange={(event) => setDueDate(event.target.value)}
        aria-label="Due date"
      />

      <button type="submit" className="primary">
        Add to backlog
      </button>
    </form>
  );
}
