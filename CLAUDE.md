# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

StockOps is an offline-first PWA for warehouse operators on PDT (Portable Data Terminal) devices to record goods received against Purchase Orders. It reads from and writes to an **existing admin MySQL/MariaDB database** (tested on MariaDB 10.4) that it does not own. Requirements live in `docs/prd.md` (functional requirements `FR-n.n`, non-functional `NF-n`, business rules `BR-n` in §10, table/column semantics in §12) and `docs/brd.md` (background and process, no IDs). `README.md` (Indonesian) documents the business rules and design decisions in detail. UI strings are in Indonesian; code comments are in English.

**Code comments carry no requirement IDs.** A comment has to be understandable without opening any document, so it states the rule itself, why it exists, and what breaks if it changes — never `FR-5.1` as a stand-in for any of that. Traceability runs the other way: the PRD's business-rule table (§10) carries an "Implementasi" column and §18 maps the FR/NF groups onto files. Cross-reference by symbol or path (`see PERMANENT_REJECT_CODES`, `src/core/receiving/memo.ts`), name the test that locks a load-bearing invariant, and don't restate what the code already says.

Stack: TanStack Start in **SPA mode** (router + server functions), React 19, Vite, Tailwind v4, Drizzle ORM over mysql2, Zod 4, Dexie (IndexedDB), Zustand. Import alias `~/*` → `src/*`.

## Commands

```bash
npm run dev              # dev server on :3000 (--host, reachable from LAN devices)
npm run build            # vite build + scripts/generate-precache.mjs (SW precache manifest)
npm start                # production server (scripts/serve.mjs) serving dist/
npm run typecheck        # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm test                 # all tests
npm run test:unit        # tests/unit only (pure logic)
npm run test:server      # tests/server (MySQL integration)
npm run test:integration # tests/integration (Dexie + full sync flow, needs MySQL)
npx vitest run tests/unit/ids.test.ts          # single file
npx vitest run -t "name of test"               # single test by name
npm run db:seed          # demo data in the `demo` DB (login pdt / pdt123)
npm run db:seed:clean    # remove demo data
```

Testing notes:
- **Every test run needs a running MySQL/MariaDB** (from `.env`): Vitest `globalSetup` (`tests/global-setup.mjs` → `scripts/lib/test-db.mjs`) always recreates the `stockops_test` schema by cloning the real DDL via `SHOW CREATE TABLE` (foreign keys stripped). `tests/setup.ts` forces `DB_NAME=stockops_test` so tests never touch `demo`.
- Tests run serially (`fileParallelism: false`, `pool: 'forks'`); default environment is `node`. Component tests opt into jsdom; client tests use `fake-indexeddb`.
- Server test fixtures (IDs, rows) are in `tests/server/helpers.ts`.
- The service worker is registered in every environment (`registerServiceWorker()` in `src/app/shell.tsx`), but full offline behavior only works on a build (`npm run build && npm start`); under `npm run dev` the cached shell goes stale. `CACHE_VERSION` no longer needs a manual bump: `scripts/stamp-sw.mjs` (last step of `npm run build`) stamps the package version and the build time into `dist/client/sw.js`, so `sw.js` differs on every build and the browser always re-runs `install` — the only moment the precache manifest is read. Under `npm run dev` the file is served unstamped and never changes, so clear a stale shell from DevTools → Application → Service Workers instead.
- **App version & reload prompt** — `public/sw.js` deliberately does NOT call `skipWaiting()` in `install`, because activating immediately deletes the previous cache version and pulls route chunks out from under an open scan session. Details in [docs/invariants/app-version-update.md](docs/invariants/app-version-update.md).
- `crypto.subtle` and service workers need a secure context: `localhost` works, but a PDT opening `http://<LAN-IP>` cannot log in or work offline.

## Architecture

Seven layers with one dependency direction. `src/server/` is a technical layer on purpose, not a
feature slice: a single `~/server/db/client` import from a component would pull `mysql2` and
`drizzle-orm` into the browser bundle, and TanStack Start only tree-shakes server code across the
`createServerFn` boundary.

```
routes  →  features  →  { ui, app, data, platform, core }
                  app  →  { features, ui, data, platform, core }
                 data  →  core
             platform  →  core
                   ui  →  { core, platform }
               server  →  core
```

- `src/core/` — pure logic, no I/O, no React, no Dexie, no database driver. `contracts/` holds what
  both runtimes share (`schemas.ts`, `constants.ts`, `diag-events.ts`); `money/`, `receiving/`,
  `identity/` and `format.ts` hold the rest. Enforced by Biome, not by discipline.
- `src/data/` — the single door to IndexedDB: `local-db.ts` (Dexie schema), `local-repo.ts`
  (`LocalRepository`, every IndexedDB access), `use-live.ts` (prerender-safe `useLiveQuery`).
  It imports `core` and nothing else. `local-repo.ts` is deliberately NOT split per feature:
  `markSynced` writes three tables in one transaction and `getPurchaseProgress` reads three.
- `src/platform/` — browser adapters and module singletons: `toast`, `theme`, `preferences`,
  `feedback`, `scan-focus`, `secure-context`, `download`.
- `src/ui/` — the design system. Knows no domain. `virtual/` holds the three-part virtualisation
  mechanism (scroller context, forced row heights, threshold).
- `src/app/` — the application frame: `shell`, `top-bar`, `bottom-nav`, `app-bar`, `pwa`,
  `update-banner`, `theme-toggle`, `app-version`, and `store/` (the Zustand slices). `store/` is the
  composition root of client state, which is why it is the one place allowed to import features
  while features import `useAppStore` back — two-way between folders, acyclic between files.
- `src/features/` — vertical slices: `auth`, `purchase-orders`, `receiving` (with `cockpit/`,
  `session/`, `review/`, `over-receive/`, `hooks/`, `logic/`), `sync`, `diagnostics`, `settings`.
  Cross-feature imports are allowed one way and must be named; today there is exactly one,
  `purchase-orders → receiving`, because starting a receiving session from a PO belongs to
  receiving.
- `src/server/` — `functions/*` are thin `createServerFn` wrappers (Zod-validate → call a service).
  Business logic lives in `services/`; `crypto/credentials.ts` holds the HMAC fingerprint;
  `db/schema.ts` *mirrors* the admin DDL (only used columns). `functions/**` is the ONLY part of
  `server/` client code may import.
- `src/routes/` — file-based routes only. Every route file is 5–12 lines: a `createFileRoute` plus
  the feature component it renders. Routes with a param read `Route.useParams()` and pass it down as
  a prop. `routeTree.gen.ts` is generated by the TanStack plugin (don't edit by hand).
- `public/sw.js` — hand-written service worker; `/_serverFn/*` and `/api/*` are always network-only. `scripts/serve.mjs` serves `dist/client` statically and forwards server-function requests to `dist/server/server.js`.

### Data flow

PDT pulls `CHECKED` POs + master data into Dexie → operator scans and enters qty in a local DRAFT session → finalized sessions go to an outbox → `syncPush` creates one `pos_receive` (status DRAFT) + items per session in a single transaction and returns the official ID and document number. The server is the source of truth; push is idempotent.

### Invariants that are easy to break

- **Never alter the admin schema** (no migrations, no Drizzle Kit against the real DB). Only read/write rows in existing tables. Any extra state must fit into existing columns — e.g. session idempotency key in `pos_receive.note` (`PDT|SESS=<uuid>;DEV=…;USR=…`) and over-receive flags in `pos_receive_item.memo` (`PDT|OVER;ORD=…;TOT=…;EXC=…`); see `src/core/receiving/memo.ts`.
- **Bigint IDs are always strings/BigInt, never `number`** — real IDs exceed 2^53. IDs are generated server-side: `(millis + 2^56 × appIdx) × 10 + randomDigit`, with PDT appIdx = 2 and admin = 1 (`src/core/identity/ids.ts`).
- Document numbers `IN<MMYY><NNNN>` use a per-month counter and are assigned only at sync time.
- Financial fields (`amount`, discounts, `total_amount`, `total_tax`) are **recomputed server-side** from PO data at sync, prorated by received qty, rounded half-up to 2 decimals (`src/core/money/receive-finance.ts`).
- Over-receive is **flagged, not rejected**, using totals aggregated across all devices/documents.
- If the server rejects a session (PO closed/deleted/validation), it becomes `REJECTED` locally, leaves the queue, and the PO list is refreshed. `UNAUTHORIZED` is deliberately *not* permanent: the session stays `FAILED` in the queue.
- **Device authentication:** server functions that read or write ERP data (`pullDataFn`, `syncPushFn`, `overReceiveWorklistFn`) require the fingerprint of at least one still-valid cached user (`assertAuthorizedDevice` in `src/server/services/auth-service.ts`; `syncPush` checks it inline). Any new server function touching ERP data must do the same. Sessions of a user whose own credential was revoked are still accepted (product decision) as long as the device is authorized.
- `pos_receive.vendor_id`, `pos_receive.location_id` and `pos_receive_item.company_id` come from the PO row, never from the client payload; `pos_receive.company_id` stays NULL. Known gap: `session.userId` is written as sent and is not tied to the authenticated device credentials.
- Over-receive: `evaluateSession` keeps a running total per PO item, so duplicate lines for one item in a session are summed; `excess` is cumulative for the first line and incremental for repeated lines (per item the lines add up to final total − ordered). Replay derives `previousQty` from the memo as `newTotal − qty`.
- Server-function errors: clients get a generic message, details go to the server log with a prefix (`[auth]`, `[pull]`, `[sync]`, `[health]`, `[env]`, `[serve]`). Only `UNAUTHORIZED_MESSAGE` is passed through, detected by string comparison (`data.ts`, `sync.ts`) — change both sides together. `loginOnline` resolves `getDb()` inside its `try` for the same reason.
- Payload limits: push ≤ 200 sessions (`MAX_PUSH_SESSIONS`) and ≤ 5000 lines per session (`MAX_SESSION_LINES`); credentials ≤ 500; pull `limit` ≤ 2000; worklist `limit` ≤ 200. The client sends the oldest 200 outbox sessions per sync.
- `npm start` (`scripts/serve.mjs`) sets `NODE_ENV=production` only if it is unset (a shell `NODE_ENV=development` silently disables the checks), which makes `getPool()` refuse weak `CREDENTIAL_HMAC_SECRET` or unset DB credentials. The refusal happens lazily on the first database request, not at start-up. Changing the secret revokes every cached credential on every device.
- `serve.mjs` reads `TLS_CERT_FILE`/`TLS_KEY_FILE`/`PORT` from the shell environment only (it does not load `.env`; `src/server/env.ts` loads it lazily via `dotenv/config`). Exactly one TLS variable set, or unreadable TLS files, exit the process instead of falling back to http.
- `sync()`, `downloadData()` and `refreshPurchases()` in the store share ONE queue (`runExclusive` in `src/app/store/sync-slice.ts`): a download can never overwrite the `receivedQty` that `markSynced` just updated. Repeated `downloadData()`/`refreshPurchases()` calls join the one already queued/running. `runSync` calls the engine's `refreshPurchases` directly (not the store action) — keep it that way to avoid a deadlock on the queue.
- Every `pull` chunk has a timeout (`PULL_TIMEOUT_MS` in `src/features/sync/engine.ts`, option `timeoutMs`), so a hung fetch cannot block the queue forever. Pulls download everything first and swap local tables in one Dexie transaction (`replaceMasterData` / `replacePurchases`), so a timeout or error leaves the old data intact.
- `markSynced` is idempotent and skips the local `receivedQty` increment on `IDEMPOTENT_REPLAY` — but NOT the per-line `serverExcess` write, which happens on both paths because a replayed answer carries the server's real figures, derived from the memo written when the document first landed; the PO list is then refreshed from the server. `runSync` raises the local `meta` flag `purchasesStale` (`PURCHASES_STALE_META_KEY`) BEFORE that refresh and clears it only once the refresh succeeds, so a crash or closed tab mid-refresh still leaves a trace. The flag is also raised when the refresh is skipped (right after a failed push, or when the current user's credential was revoked, because the pull would fail anyway). If the refresh fails, `runSync` tells the operator; it is retried on every later `sync()` and on auto-sync when the device is online again, and any successful refresh/download also clears the flag.
- **The receiving screens must never recompute over-receive for a SYNCED session.** The same `receivedQty` increment that keeps the PO list's "Diterima" figure from dipping also puts this session's qty into the snapshot, so `receivedQty + thisSession - ordered` counts it twice and a delivery that exactly fills the order reports the whole delivery as excess. The next pull does not heal it: the server's own number contains the session too. `sessionExcessByPurchaseItem` (`src/features/receiving/logic/session-view.ts`) is the ONE place that chooses the source — the local comparison before the session is sent, the server's per-line `serverExcess` after it. A SYNCED session with no stored figure (synced before the field existed, or a replay whose memo could not be parsed) yields an EMPTY map on purpose, which is what makes the scan cockpit fall back to the document-level `session.excessTotal`, the same sentence the receiving list already shows. The review screen needs no such fallback: it returns early for any status other than RUNNING, so a document that would need the message can never reach its body.
- `syncOutbox` handles the server's answer per session: a local write error (or a failing log write) never reverts a session that is already `SYNCED`, a session the server did not answer for becomes `FAILED` instead of staying `SYNCING`, and `markFailed`/`markRejected` never override `SYNCED`. Answers for an unknown or an already answered session id are ignored (and logged), so `synced`/`failed` never exceed `attempted`. Every `syncOutbox` run first calls `resetStaleSyncingSessions()` (atomic, one transaction): sync runs never overlap, so anything still `SYNCING` is stale and goes back to the queue.
- Code that touches IndexedDB must tolerate running without it (SPA prerender in Node): use `useLive` (`src/data/use-live.ts`) instead of raw `useLiveQuery`, and `isBrowser()` guards in the store.
- **UI invariants (scan loop)** — the scan loop must fit 360×640 without scrolling, and only a successful scan result disappears on its own while the other three wait for the operator. Details in [docs/invariants/ui-scan-loop.md](docs/invariants/ui-scan-loop.md).
- **Themes** — colour lives in semantic tokens in `src/styles/app.css` declared with `@theme` (not inline), the light theme is a single `:root[data-theme='light']` block, and both the app bar and settings must read the subscriber singleton or preferences revert on next start. **Light is the default**, and four places must name the same default (the inline script and the `theme-color` meta in `__root.tsx`, `getServerTheme()`, and the manifest) or every app start flashes the wrong theme. Details in [docs/invariants/themes.md](docs/invariants/themes.md).
- **Scan feedback** — every tone sits at or above 950 Hz and uses a square wave; lower frequencies are inaudible on PDT hardware, making failure signals silent in the field. Details in [docs/invariants/scan-feedback.md](docs/invariants/scan-feedback.md).
- **Session ownership** — screens ask `src/features/receiving/logic/session-owner.ts` instead of comparing IDs, non-owners get `SessionOwnerGate` and a read-only cockpit, and non-owner write controls are blocked to prevent deleting colleagues' data. Details in [docs/invariants/session-ownership.md](docs/invariants/session-ownership.md).
- **Dedupe per PO** — only RUNNING sessions belonging to the current operator are deduped, allowing colleagues to work concurrently and preserving escape hatches for genuine multiple deliveries. Details in [docs/invariants/dedupe-session-per-po.md](docs/invariants/dedupe-session-per-po.md).
- **Pick from the PO list** — lines added without barcodes share `AddScanResult`, conversion logic, and `addedHero` with scans, and `pickedManually` stays sticky to record that unverified quantities were received. Details in [docs/invariants/pick-from-po.md](docs/invariants/pick-from-po.md).
- **Diagnostics trail** — `syncLog` is written strictly through `LocalRepository.logEvent` with a 2000-entry ring buffer, never throwing to callers, and exports are local-only CSVs with clipboard fallback. Details in [docs/invariants/diagnostics-trail.md](docs/invariants/diagnostics-trail.md).
- **Virtualized lists** — row heights are precomputed and forced, below threshold lists render simply, and row identity is measurement identity so all inputs must live inside rows or text lines vanish silently across all rows. Details in [docs/invariants/virtual-lists.md](docs/invariants/virtual-lists.md).

## Repo conventions

- `/plans/` (gitignored) holds internal implementation plans in Indonesian; existing ones show how past features were scoped.
- `.opencode/agents/react-review.md` defines a read-only React review agent built on `npx react-doctor@latest --verbose`; recent "react-review" fix commits come from its findings.
