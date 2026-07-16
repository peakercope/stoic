import { createStore } from "stoic-store";
import { persist } from "stoic-store/plugins";
import { type ColumnId, DONE, type Label, seedTasks, type Task } from "./data";

type Filter = {
  search: string;
  assignee: string | null;
  label: Label | null;
};

type BoardState = {
  tasks: Task[];
  filter: Filter;
  /** Today's date (YYYY-MM-DD), captured once at load. Derived functions must
   * stay pure, so the clock is read here — in state — not inside `derived`. */
  today: string;
};

type BoardDerived = {
  filteredTasks: Task[];
  tasksByColumn: Record<ColumnId, Task[]>;
  completedCount: number;
  overdueTasks: Task[];
  overdueCount: number;
  completionRate: number;
};

const today = (): string => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const matches = (task: Task, filter: Filter): boolean => {
  const query = filter.search.trim().toLowerCase();
  if (query && !task.title.toLowerCase().includes(query)) return false;
  if (filter.assignee && task.assignee !== filter.assignee) return false;
  if (filter.label && task.label !== filter.label) return false;
  return true;
};

export const board = createStore<BoardState, BoardDerived>({
  state: {
    tasks: seedTasks,
    filter: { search: "", assignee: null, label: null },
    today: today(),
  },

  // The board's whole view model is derived. Columns, counts and the overdue
  // list are never stored — move one task and every number below follows.
  derived: {
    filteredTasks: ({ tasks, filter }) => tasks.filter((task) => matches(task, filter)),

    // Columns render straight from this, so filtering and drag-and-drop share
    // exactly one source of truth.
    tasksByColumn: ({ filteredTasks }) => {
      const grouped: Record<ColumnId, Task[]> = {
        backlog: [],
        "in-progress": [],
        review: [],
        done: [],
      };
      for (const task of filteredTasks) grouped[task.columnId].push(task);
      return grouped;
    },

    // Stats describe the whole board, not the filtered view — so they read
    // `tasks`, and a search doesn't make your progress bar move.
    completedCount: ({ tasks }) => tasks.filter((task) => task.columnId === DONE).length,

    overdueTasks: ({ tasks, today }) =>
      tasks.filter((task) => task.columnId !== DONE && task.dueDate < today),

    // Derived from derived.
    overdueCount: ({ overdueTasks }) => overdueTasks.length,

    completionRate: ({ tasks, completedCount }) =>
      tasks.length === 0 ? 0 : completedCount / tasks.length,
  },

  // Only the tasks are persisted. Filters are transient UI, so a reload gives
  // you the board back with a clean view.
  plugins: [persist<BoardState>({ key: "stoic-kanban", include: ["tasks"], debounceMs: 200 })],
});

export const { addTask, moveTask, deleteTask, setSearch, setAssignee, setLabel } = board.actions({
  addTask: ({ set }, task: Omit<Task, "id">) => {
    set((s) => ({
      tasks: [...s.tasks, { ...task, id: crypto.randomUUID() }],
    }));
  },

  /** Drag-and-drop is just this: a task's column *is* its status. */
  moveTask: ({ set }, id: string, columnId: ColumnId) => {
    set((s) => ({
      tasks: s.tasks.map((task) => (task.id === id ? { ...task, columnId } : task)),
    }));
  },

  deleteTask: ({ set }, id: string) => {
    set((s) => ({ tasks: s.tasks.filter((task) => task.id !== id) }));
  },

  setSearch: ({ set }, search: string) => set((s) => ({ filter: { ...s.filter, search } })),

  setAssignee: ({ set }, assignee: string | null) =>
    set((s) => ({ filter: { ...s.filter, assignee } })),

  setLabel: ({ set }, label: Label | null) => set((s) => ({ filter: { ...s.filter, label } })),
});
