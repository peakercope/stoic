import { useStore } from "stoic-store/react";
import { search } from "../store";

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function pushedAgo(iso: string): string {
  const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
  if (days > -31) return relative.format(days, "day");
  return relative.format(Math.round(days / 30), "month");
}

export function RepoList() {
  // `visibleRepos` is derived from repos + sort + language + hideForks, so
  // changing any control re-derives this list without touching the network.
  const repos = useStore(search, (s) => s.visibleRepos);

  if (repos.length === 0) {
    return <p className="muted pad">No repositories match these filters.</p>;
  }

  return (
    <ul className="repo-list">
      {repos.map((repo) => (
        <li key={repo.id}>
          <div className="repo-head">
            <a href={repo.html_url} target="_blank" rel="noreferrer">
              {repo.name}
            </a>
            {repo.fork && <span className="tag">fork</span>}
          </div>

          {repo.description && <p className="muted">{repo.description}</p>}

          <p className="repo-meta muted">
            {repo.language && <span>{repo.language}</span>}
            <span>★ {repo.stargazers_count.toLocaleString()}</span>
            <span>⑂ {repo.forks_count.toLocaleString()}</span>
            <span>pushed {pushedAgo(repo.pushed_at)}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
