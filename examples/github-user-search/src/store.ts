import { createStore } from "../../../src/stoic";
import type { GitHubUser, Profile, Repo } from "./api";
import * as api from "./api";

export type SortKey = "stars" | "updated" | "name";

type SearchState = {
  results: GitHubUser[];
  selected: string | null;
  profile: Profile | null;
  repos: Repo[];
  sort: SortKey;
  language: string | null;
  hideForks: boolean;
};

type SearchDerived = {
  languages: string[];
  visibleRepos: Repo[];
  totalStars: number;
};

const byStars = (a: Repo, b: Repo) => b.stargazers_count - a.stargazers_count;
const byUpdated = (a: Repo, b: Repo) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at);
const byName = (a: Repo, b: Repo) => a.name.localeCompare(b.name);

const SORTS: Record<SortKey, (a: Repo, b: Repo) => number> = {
  stars: byStars,
  updated: byUpdated,
  name: byName,
};

export const search = createStore<SearchState, SearchDerived>({
  state: {
    results: [],
    selected: null,
    profile: null,
    repos: [],
    sort: "stars",
    language: null,
    hideForks: false,
  },

  derived: {
    // The language filter's options come from the data itself.
    languages: ({ repos }) =>
      [
        ...new Set(repos.map((repo) => repo.language).filter((l): l is string => l !== null)),
      ].sort(),

    // Sorting and filtering are a projection of (repos, sort, language, hideForks) —
    // changing a filter never refetches, it just re-derives.
    visibleRepos: ({ repos, sort, language, hideForks }) =>
      repos
        .filter((repo) => language === null || repo.language === language)
        .filter((repo) => !hideForks || !repo.fork)
        .sort(SORTS[sort]),

    totalStars: ({ repos }) => repos.reduce((sum, repo) => sum + repo.stargazers_count, 0),
  },
});

export const { findUsers, selectUser, setSort, setLanguage, setHideForks } = search.actions({
  findUsers: async ({ set }, query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      set({ results: [] });
      return;
    }
    set({ results: await api.searchUsers(trimmed) });
  },

  // Profile and repos are fetched together, then land in a single set —
  // one recompute, one render, no half-loaded UI.
  selectUser: async ({ set, get }, login: string) => {
    set({ selected: login, profile: null, repos: [], language: null });

    const [profile, repos] = await Promise.all([api.fetchProfile(login), api.fetchRepos(login)]);

    // Guard against a stale response: if another user was selected while this
    // fetch was in flight, the newer selection wins and this result is dropped.
    if (get().selected !== login) return;

    set({ profile, repos });
  },

  setSort: ({ set }, sort: SortKey) => set({ sort }),

  setLanguage: ({ set }, language: string | null) => set({ language }),

  setHideForks: ({ set }, hideForks: boolean) => set({ hideForks }),
});
