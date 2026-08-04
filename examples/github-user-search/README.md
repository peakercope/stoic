# GitHub User Search

Search GitHub users, open a profile, and sort/filter their repositories — against the
real GitHub REST API.

```bash
# once, from the repository root: the Vite alias resolves to dist/prod
yarn install && yarn build

# then, here
yarn install
yarn dev
```

No API token needed. Unauthenticated GitHub allows 60 requests/hour per IP, and the app
renders that rate limit as a real error state when you hit it.
