import { findUsers, search, selectUser } from "../store";

export function UserList() {
  const results = search.useStore((s) => s.results);
  const selected = search.useStore((s) => s.selected);
  const { status } = findUsers.useMeta();

  if (status === "success" && results.length === 0) {
    return <p className="muted pad">No users matched that search.</p>;
  }

  return (
    <ul className="user-list">
      {results.map((user) => (
        <li key={user.id}>
          <button
            type="button"
            className={user.login === selected ? "user active" : "user"}
            onClick={() => selectUser(user.login).catch(() => {})}
          >
            <img src={user.avatar_url} alt="" width={32} height={32} />
            <span>{user.login}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
