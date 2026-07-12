import { search, selectUser } from "../store";
import { RepoControls } from "./RepoControls";
import { RepoList } from "./RepoList";

export function UserProfile() {
  const selected = search.useStore((s) => s.selected);
  const profile = search.useStore((s) => s.profile);
  const totalStars = search.useStore((s) => s.totalStars);
  const { status, error } = selectUser.useMeta();

  if (!selected) {
    return <p className="muted pad">Search for a user, then pick one to see their repos.</p>;
  }

  if (status === "pending") {
    return <p className="muted pad">Loading {selected}…</p>;
  }

  if (status === "error") {
    return (
      <p className="error" role="alert">
        {error instanceof Error ? error.message : "Failed to load this profile."}
      </p>
    );
  }

  if (!profile) return null;

  return (
    <div className="profile">
      <header>
        <img src={profile.avatar_url} alt="" width={64} height={64} />
        <div>
          <h2>
            <a href={profile.html_url} target="_blank" rel="noreferrer">
              {profile.name ?? profile.login}
            </a>
          </h2>
          {profile.bio && <p className="muted">{profile.bio}</p>}
          <p className="stats muted">
            {profile.followers.toLocaleString()} followers · {profile.public_repos.toLocaleString()}{" "}
            repos · {totalStars.toLocaleString()} stars across fetched repos
          </p>
        </div>
      </header>

      <RepoControls />
      <RepoList />
    </div>
  );
}
