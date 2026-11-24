# Release & Versioning

The version of the app is the `version` field of `package.json`, and only `npm run release` (release-it) ever changes it. The app shows it in Pengaturan and in the diagnostics export, `scripts/stamp-sw.mjs` writes it into `dist/client/sw.js` (where it becomes part of `CACHE_VERSION`) and into `dist/build-info.json`, and the git tag `v<version>` is what a server is allowed to run. Never edit the field by hand: `versionProblems` in `scripts/deploy/package-rules.mjs` refuses to package a build when `v<package.json version>` is not the tag that `git describe` reports, so a hand-edited version blocks packaging instead of shipping a lie. Between releases the field keeps the last released version; under `npm run dev` and in tests the app shows `dev` (see `src/app/app-version.ts`).

## Tags and the commit convention

A stable tag is `vX.Y.Z`, a release candidate is `vX.Y.Z-rc.N` (N starts at 1); both patterns live in `scripts/lib/version-rules.mjs`, which has no dependencies because the release script and the package builder both load it. Anything else that `git describe --tags --always --dirty` can print (a commit id, a text ending in `-dirty`, `v1.2.0-3-g1a2b3c4`) is not a release and can never be installed. A tag is never moved, deleted or reused: a wrong release is fixed with a new version.

Commit messages follow `type(scope): text` (types: feat, fix, perf, refactor, docs, style, test, chore, build, ci, revert). The release script reads the commits since the last STABLE tag (release candidate tags do not count, merge commits are skipped): `type!:` or a `BREAKING CHANGE:` footer asks for a major bump (while the major number is 0 the minor number grows instead), `feat` asks for a minor bump, everything else for a patch. A commit that does not follow the pattern stops the release; rewrite it with a rebase. The commits before the very first release are not checked.

## Lanes

The lane follows from the last stable tag and the next version (`laneOf` in `scripts/release/release-rules.mjs`):

- **first** — nothing was released before. Gates with build, no release candidate required, no CHANGELOG entry (the first entry is written by hand in `CHANGELOG.md`).
- **fast** — only the patch number grows. Gates without build, no release candidate (the script refuses `rc`), CHANGELOG entry from the commits.
- **full** — the minor or major number grows. Gates with build, and a stable release needs a release candidate that was tried on staging: the files that changed since the last `vX.Y.Z-rc.N` tag may only be `package.json`, `package-lock.json` and `CHANGELOG.md` (`RC_TO_STABLE_ALLOWED`), otherwise the code was not what staging approved and a new candidate is needed. CHANGELOG entry from the commits.

A release candidate never writes a CHANGELOG entry (it uses `.release-it.no-changelog.json`).

## How a release is made

Only the owner runs it, from `main`, with a clean working tree that is in step with `origin/main`:

1. `npm run release -- --dry-run` lists the next version, the lane and everything in the way; it changes nothing and runs no gate.
2. `npm run release -- rc` (minor and major releases) makes `vX.Y.Z-rc.N`, then `git switch --detach vX.Y.Z-rc.N`, `npm run release:pack -- staging`, `git switch main`.
3. After staging was checked: `npm run release` makes `vX.Y.Z`, then the same with `production`.

The gates are `npm run typecheck`, `npm run lint`, `npm run test` and, for the first and full lanes, `npm run build`. The tests need the MySQL/MariaDB from `.env`. The build must leave the working tree clean: `src/routeTree.gen.ts` is tracked, and if a build rewrites it the release stops until the result is committed.

`package.json` starts at `0.0.0` on purpose: release-it takes an explicit version only when it is not lower than the current one, so the very first `npm run release -- rc` writes `0.1.0-rc.1` over `0.0.0`. Two settings in `.release-it.json` look optional and are not: `effect: "hidden"` on every type except feat, fix and perf (this changelog preset ignores a plain `hidden: true`, so docs, refactor and chore commits would flood the entry), and `writerOpts.generateOn: null` (without it the release candidate tag inside the range starts a second, duplicate entry for the same stable release). `tests/unit/release-config.test.ts` locks both.

Claude and other agents never run `npm run release` (except with `--dry-run` or `--help`), never run `release-it`, and never create, move, delete or push a git tag.

## Packages

`npm run release:pack -- <staging|production>` builds with `scripts/build.mjs <mode>`, checks the build, and makes one `.tgz` in `release-packages/` (git-ignored). It never connects to a server. It refuses a dirty tree, a build that rewrote a tracked file, and any commit that is not exactly at a tag: production needs a stable tag, staging a stable or a release candidate tag. `--local-only` packages any commit to try on the same computer and must never be installed on a server.

The base path (the tenant) is baked into the build, so a package only fits the tenant it was built for. It comes from `STOCKOPS_BASE_PATH` in `.env.<mode>` of the build computer, or from `--base-path`, which wins (write it without a leading slash, for example `--base-path oxy-stockops-coco`: the slashes are added for you, and Git Bash rewrites an argument that starts with `/` into a Windows path); the package name carries the tenant, the mode, the version and the time. The package holds `dist/`, `scripts/serve.mjs` with the two helpers it imports, `package.json`, `package-lock.json` and `.env.example` (`PAYLOAD` in `scripts/deploy/package-release.mjs`) and never an `.env` file: the secrets live on the server, and `tests/unit/package-release.test.ts` fails if one ever goes in. The server runs `npm ci --omit=dev`, which is why `dotenv` is a production dependency.

`scripts/stamp-sw.mjs` writes `dist/build-info.json` (version, build time, mode, base path, tenant slug) as the last build step, and `bundleProblems` in `scripts/deploy/bundle-check.mjs` (also `npm run smoke:build`) checks `dist/` by reading files only: `sw.js` is stamped and agrees with the build record, and every URL in `precache-manifest.json` is inside the base path and exists, because one missing file makes the whole service worker install fail and the PDT never gets an offline copy.

On the server, by hand: create a new deploy folder, `tar -xzf` the package into it, put the env file next to `package.json` (copied from the previous release folder, or made from `.env.example`), `npm ci --omit=dev`, then `npm run serve:production` (or `serve:staging`). Rolling back means starting the previous folder again, so it is not deleted until the new release has proved healthy. A new release changes `sw.js`, so PDTs offer the reload banner described in [app-version-update.md](app-version-update.md).

Locked by `tests/unit/version-rules.test.ts`, `build-info.test.ts`, `release-rules.test.ts`, `release-flow.test.ts`, `release-config.test.ts`, `bundle-check.test.ts`, `package-rules.test.ts`, `package-flow.test.ts` and `package-release.test.ts`.
