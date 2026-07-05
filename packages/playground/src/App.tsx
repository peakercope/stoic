import { useEffect } from "react";
import { createStore } from "stoic-store";
import { persist } from "stoic-store/plugins";

const tax = 0.2;
const discount = 0.1;

const state = {
  count: 0,
  price: 0,
  count2: 0,
};

export const counter = createStore<
  typeof state,
  { subtotal: number; total: number; finalPrice: number }
>({
  state,
  derived: {
    subtotal: (s) => s.price * s.count,
    total: (s) => s.subtotal * (1 + tax),
    finalPrice: (s) => s.total * (1 - discount),
  },
});

const { inc } = counter.actions({
  inc: (setState) => {
    setState((s) => ({ count: s.count + 1 }));
  },
});
const { useStore } = counter;

function Button() {
  return (
    <button
      type="button"
      onClick={() => {
        inc();
      }}
    >
      click me (b1)
    </button>
  );
}

function Button2() {
  return (
    <button
      type="button"
      onClick={() => {
        counter.setState((s) => ({
          count2: s.count2 + 1,
        }));
      }}
    >
      click me (b2)
    </button>
  );
}

const Value = () => {
  const count = useStore((s) => s.count);

  return <div>{count}</div>;
};

const Value2 = () => {
  const count = useStore((s) => s.count2);

  return <div>{count}</div>;
};

const DerivedValue = () => {
  const subtotal = useStore((s) => s.subtotal);

  return (
    <div>
      <p>subtotal: {subtotal}</p>
    </div>
  );
};

const TotalValue = () => {
  const total = useStore((s) => s.total);

  return (
    <div>
      <p>total: {total}</p>
    </div>
  );
};

const Sibling = () => {
  return <div>Sibling</div>;
};

const Input = () => {
  const price = useStore((s) => s.price);

  return (
    <input
      type="number"
      value={price}
      onChange={(e) => {
        const next = Number(e.target.value);
        counter.setState({ price: next });
      }}
    />
  );
};

const usersStore = createStore<{
  users: { id: number; name: string; email: string }[];
}>({
  state: {
    users: [],
  },
  plugins: [persist({ key: "usersStore", storage: () => localStorage })],
});

const { loadUsers } = usersStore.actions({
  loadUsers: async (setState) => {
    const users = await fetch(
      `https://jsonplaceholder.typicode.com/users`,
    ).then((r) => {
      if (!r.ok) {
        throw new Error(`HTTP error! status: ${r.status}`);
      }
      return r.json();
    });

    setState({ users });
  },
});

function Users() {
  const { users } = usersStore.useStore();
  const { status, error } = loadUsers.useMeta();

  useEffect(() => {
    loadUsers();
  }, []);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          loadUsers();
        }}
      >
        re-load
      </button>
      {status === "pending" && <div>Loading...</div>}
      {status === "error" && <div>Failed to load users: {String(error)}</div>}
      <ul>
        {users.map((u) => (
          <li key={u.id}>
            {u.name} - ({u.email})
          </li>
        ))}
      </ul>
    </div>
  );
}

export function App() {
  return (
    <div>
      <Input />
      <br />
      --------
      <br />
      <Button />
      <Value />
      <br />
      --------
      <br />
      <Button2 />
      <Value2 />
      <br />
      --------
      <br />
      <DerivedValue />
      <TotalValue />
      <br />
      --------
      <br />
      <Sibling />
      <br />
      --------
      <br />
      <Users />
    </div>
  );
}
