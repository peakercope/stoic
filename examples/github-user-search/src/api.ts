/**
 * Thin wrapper over the public GitHub REST API. Unauthenticated requests are
 * rate-limited to 60/hour per IP, so `request` turns a 403 rate-limit response
 * into a readable error rather than letting it surface as a generic failure.
 */

const BASE = "https://api.github.com";

export type GitHubUser = {
  id: number;
  login: string;
  avatar_url: string;
};

export type Profile = GitHubUser & {
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  following: number;
  public_repos: number;
  html_url: string;
};

export type Repo = {
  id: number;
  name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string;
  html_url: string;
  fork: boolean;
};

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/vnd.github+json" },
    signal,
  });

  if (response.ok) return (await response.json()) as T;

  if (response.status === 403 || response.status === 429) {
    const reset = response.headers.get("x-ratelimit-reset");
    const when = reset ? new Date(Number(reset) * 1000).toLocaleTimeString() : null;
    throw new Error(
      when
        ? `GitHub rate limit reached. Try again after ${when}.`
        : "GitHub rate limit reached. Try again later.",
    );
  }

  if (response.status === 404) {
    throw new Error("Not found on GitHub.");
  }

  throw new Error(`GitHub request failed (${response.status}).`);
}

export async function searchUsers(query: string, signal?: AbortSignal): Promise<GitHubUser[]> {
  const { items } = await request<{ items: GitHubUser[] }>(
    `/search/users?q=${encodeURIComponent(query)}&per_page=12`,
    signal,
  );
  return items;
}

export const fetchProfile = (login: string, signal?: AbortSignal): Promise<Profile> =>
  request<Profile>(`/users/${encodeURIComponent(login)}`, signal);

export const fetchRepos = (login: string, signal?: AbortSignal): Promise<Repo[]> =>
  request<Repo[]>(`/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed`, signal);
