import { type FormEvent, useState } from "react";
import { findUsers } from "../store";

export function SearchBar() {
  const [query, setQuery] = useState("");
  const { status, error } = findUsers.useMeta();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    findUsers(query).catch(() => {});
  }

  return (
    <div className="search">
      <form onSubmit={onSubmit}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search GitHub users…"
          aria-label="Search GitHub users"
        />
        <button type="submit" className="primary" disabled={status === "pending"}>
          {status === "pending" ? "Searching…" : "Search"}
        </button>
      </form>

      {status === "error" && (
        <p className="error" role="alert">
          {error instanceof Error ? error.message : "Search failed."}
        </p>
      )}
    </div>
  );
}
