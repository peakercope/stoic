import { useStore } from "stoic-store/react";
import { shallow } from "stoic-store/tools";
import { type SortKey, search, setHideForks, setLanguage, setSort } from "../store";

export function RepoControls() {
  const { languages, language, sort, hideForks } = useStore(
    search,
    (s) => ({
      languages: s.languages,
      language: s.language,
      sort: s.sort,
      hideForks: s.hideForks,
    }),
    shallow,
  );

  return (
    <div className="repo-controls">
      <label>
        Sort
        <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
          <option value="stars">Most stars</option>
          <option value="updated">Recently pushed</option>
          <option value="name">Name</option>
        </select>
      </label>

      <label>
        Language
        <select
          value={language ?? ""}
          onChange={(event) => setLanguage(event.target.value || null)}
        >
          <option value="">All languages</option>
          {languages.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={hideForks}
          onChange={(event) => setHideForks(event.target.checked)}
        />
        Hide forks
      </label>
    </div>
  );
}
