import { SearchBar } from "./components/SearchBar";
import { UserList } from "./components/UserList";
import { UserProfile } from "./components/UserProfile";

export function App() {
  return (
    <div className="page">
      <header className="masthead">
        <h1>GitHub user search</h1>
        <p className="muted">
          Sorting and filtering are derived state — changing a control never refetches.
        </p>
      </header>

      <SearchBar />

      <main className="layout">
        <aside>
          <UserList />
        </aside>
        <section>
          <UserProfile />
        </section>
      </main>
    </div>
  );
}
