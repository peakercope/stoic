export type ColumnId = "backlog" | "in-progress" | "review" | "done";

export type Column = {
  id: ColumnId;
  title: string;
};

export type Task = {
  id: string;
  columnId: ColumnId;
  title: string;
  assignee: string;
  /** ISO date (YYYY-MM-DD). */
  dueDate: string;
  label: Label;
};

export type Label = "bug" | "feature" | "chore";

export const columns: Column[] = [
  { id: "backlog", title: "Backlog" },
  { id: "in-progress", title: "In progress" },
  { id: "review", title: "In review" },
  { id: "done", title: "Done" },
];

export const assignees = ["Ada", "Grace", "Linus", "Margaret"];
export const labels: Label[] = ["bug", "feature", "chore"];

/** A task in the `done` column is complete — status is a position, not a flag. */
export const DONE: ColumnId = "done";

const daysFromNow = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

export const seedTasks: Task[] = [
  {
    id: "t1",
    columnId: "backlog",
    title: "Rate-limit the public search endpoint",
    assignee: "Ada",
    dueDate: daysFromNow(9),
    label: "chore",
  },
  {
    id: "t2",
    columnId: "backlog",
    title: "Support SSO via Okta",
    assignee: "Grace",
    dueDate: daysFromNow(21),
    label: "feature",
  },
  {
    id: "t3",
    columnId: "in-progress",
    title: "Invoice PDF renders totals incorrectly",
    assignee: "Linus",
    dueDate: daysFromNow(-3), // overdue
    label: "bug",
  },
  {
    id: "t4",
    columnId: "in-progress",
    title: "Migrate billing jobs to the new queue",
    assignee: "Ada",
    dueDate: daysFromNow(4),
    label: "chore",
  },
  {
    id: "t5",
    columnId: "review",
    title: "Bulk CSV export for admins",
    assignee: "Margaret",
    dueDate: daysFromNow(-1), // overdue
    label: "feature",
  },
  {
    id: "t6",
    columnId: "review",
    title: "Session cookie not cleared on logout",
    assignee: "Grace",
    dueDate: daysFromNow(2),
    label: "bug",
  },
  {
    id: "t7",
    columnId: "done",
    title: "Add audit log to the settings page",
    assignee: "Linus",
    dueDate: daysFromNow(-6),
    label: "feature",
  },
  {
    id: "t8",
    columnId: "done",
    title: "Upgrade to React 19",
    assignee: "Margaret",
    dueDate: daysFromNow(-10),
    label: "chore",
  },
];
