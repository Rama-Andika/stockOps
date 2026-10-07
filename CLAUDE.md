# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

StockOps is an offline-first PWA for warehouse operators on PDT (Portable Data Terminal) devices to record goods received against Purchase Orders. It reads from and writes to an **existing admin MySQL/MariaDB database** (tested on MariaDB 10.4) that it does not own. Requirements live in `PRD_Penerimaan_Barang_PDT.md` (functional requirements `FR-n.n`, non-functional `NF-n`, business rules `BR-n` in §10, table/column semantics in §12) and `BRD_Penerimaan_Barang_PDT.md` (background and process, no IDs). `README.md` (Indonesian) documents the business rules and design decisions in detail. UI strings are in Indonesian; code comments are in English.

**Code comments carry no requirement IDs.** A comment has to be understandable without opening any document, so it states the rule itself, why it exists, and what breaks if it changes — never `FR-5.1` as a stand-in for any of that. Traceability runs the other way: the PRD's business-rule table (§10) carries an "Implementasi" column and §18 maps the FR/NF groups onto files. Cross-reference by symbol or path (`see PERMANENT_REJECT_CODES`, `src/shared/memo.ts`), name the test that locks a load-bearing invariant, and don't restate what the code already says.

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
npm run test:client      # tests/client (Dexie + full sync flow)
npx vitest run tests/unit/ids.test.ts          # single file
npx vitest run -t "name of test"               # single test by name
npm run db:seed          # demo data in the `demo` DB (login pdt / pdt123)
npm run db:seed:clean    # remove demo data
```

Testing notes:
- **Every test run needs a running MySQL/MariaDB** (from `.env`): Vitest `globalSetup` (`tests/global-setup.mjs` → `scripts/lib/test-db.mjs`) always recreates the `stockops_test` schema by cloning the real DDL via `SHOW CREATE TABLE` (foreign keys stripped). `tests/setup.ts` forces `DB_NAME=stockops_test` so tests never touch `demo`.
- Tests run serially (`fileParallelism: false`, `pool: 'forks'`); default environment is `node`. Component tests opt into jsdom; client tests use `fake-indexeddb`.
- Server test fixtures (IDs, rows) are in `tests/server/helpers.ts`.
- The service worker is registered in every environment (`registerServiceWorker()` in `src/components/app-shell.tsx`), but full offline behavior only works on a build (`npm run build && npm start`); under `npm run dev` the cached shell goes stale. `CACHE_VERSION` no longer needs a manual bump: `scripts/stamp-sw.mjs` (last step of `npm run build`) stamps the package version and the build time into `dist/client/sw.js`, so `sw.js` differs on every build and the browser always re-runs `install` — the only moment the precache manifest is read. Under `npm run dev` the file is served unstamped and never changes, so clear a stale shell from DevTools → Application → Service Workers instead.
- **App version & reload prompt (plans/implementation-plan-versi-app-prompt-muat-ulang.md):** `public/sw.js` deliberately does NOT call `skipWaiting()` in `install` — a new worker stays in `waiting` until the operator accepts the banner, because `activate` deletes the previous `CACHE_VERSION` and would otherwise pull the route chunks out from under an open scan session. The only activation path is the `SKIP_WAITING` message (`activateUpdate()` in `src/client/pwa.ts`), whose reload waits for `controllerchange`; that listener is armed inside `activateUpdate` and nowhere else, because `clients.claim()` also fires it on a device's first install. The banner shares ONE app-bar row with `SyncStatus` and `SyncStatus` always wins (`useSendStatus()` in `sync-status.tsx` is the single definition of "quiet", read by `TopBar`), so a pending outbox hides the banner rather than hiding the "Kirim" button — which is why `UpdateBanner`'s `pendingCount` branch is currently unreachable and is kept on purpose. "Nanti" is 15 minutes, in memory only (`UPDATE_SNOOZE_MS`). Because the banner renders on every screen, the cockpit included, its "Nanti" hands the focus back to the barcode field through `src/client/scan-focus.ts` — a module singleton, because the app bar is a sibling of the route that owns `scanRef`.
- `crypto.subtle` and service workers need a secure context: `localhost` works, but a PDT opening `http://<LAN-IP>` cannot log in or work offline.

## Architecture

Three layers, with a strict dependency direction: `routes/components → client → shared ← server`. The client reaches the server **only** through server functions.

- `src/shared/` — pure logic used on both sides: bigint ID scheme, document numbering, UOM conversion, barcode matching, over-receive math, receive financial recalculation, `note`/`memo` conventions, and the Zod contracts (`schemas.ts`) for every server function.
- `src/server/` — `functions/*` are thin `createServerFn` wrappers (Zod-validate → call a service). Business logic lives in `services/` (`auth-service`, `pull-service`, `sync-service`). `db/schema.ts` *mirrors* the admin DDL (only used columns).
- `src/client/` — `db/local-db.ts` (Dexie schema) + `db/local-repo.ts` (`LocalRepository`, all IndexedDB access); `sync/engine.ts` (pull master/PO data in chunks, push finalized sessions from the outbox); `sync/transport.ts` (`SyncTransport` interface — `serverTransport` calls server functions, tests inject a transport that calls services directly against the test DB); `auth/offline-auth.ts` (PBKDF2-cached credentials, 7-day offline login); `state/store/` (Zustand store split into auth/sync/app slices, provided via an SSR-safe `AppStoreProvider` that also triggers auto-sync on reconnect).
- `src/routes/` — file-based routes; `routeTree.gen.ts` is generated by the TanStack plugin (don't edit by hand).
- `public/sw.js` — hand-written service worker; `/_serverFn/*` and `/api/*` are always network-only. `scripts/serve.mjs` serves `dist/client` statically and forwards server-function requests to `dist/server/server.js`.

### Data flow

PDT pulls `CHECKED` POs + master data into Dexie → operator scans and enters qty in a local DRAFT session → finalized sessions go to an outbox → `syncPush` creates one `pos_receive` (status DRAFT) + items per session in a single transaction and returns the official ID and document number. The server is the source of truth; push is idempotent.

### Invariants that are easy to break

- **Never alter the admin schema** (no migrations, no Drizzle Kit against the real DB). Only read/write rows in existing tables. Any extra state must fit into existing columns — e.g. session idempotency key in `pos_receive.note` (`PDT|SESS=<uuid>;DEV=…;USR=…`) and over-receive flags in `pos_receive_item.memo` (`PDT|OVER;ORD=…;TOT=…;EXC=…`); see `src/shared/memo.ts`.
- **Bigint IDs are always strings/BigInt, never `number`** — real IDs exceed 2^53. IDs are generated server-side: `(millis + 2^56 × appIdx) × 10 + randomDigit`, with PDT appIdx = 2 and admin = 1 (`src/shared/ids.ts`).
- Document numbers `IN<MMYY><NNNN>` use a per-month counter and are assigned only at sync time.
- Financial fields (`amount`, discounts, `total_amount`, `total_tax`) are **recomputed server-side** from PO data at sync, prorated by received qty, rounded half-up to 2 decimals (`src/shared/receive-finance.ts`).
- Over-receive is **flagged, not rejected**, using totals aggregated across all devices/documents.
- If the server rejects a session (PO closed/deleted/validation), it becomes `REJECTED` locally, leaves the queue, and the PO list is refreshed. `UNAUTHORIZED` is deliberately *not* permanent: the session stays `FAILED` in the queue.
- **Device authentication:** server functions that read or write ERP data (`pullDataFn`, `syncPushFn`, `overReceiveWorklistFn`) require the fingerprint of at least one still-valid cached user (`assertAuthorizedDevice` in `src/server/services/auth-service.ts`; `syncPush` checks it inline). Any new server function touching ERP data must do the same. Sessions of a user whose own credential was revoked are still accepted (product decision) as long as the device is authorized.
- `pos_receive.vendor_id`, `pos_receive.location_id` and `pos_receive_item.company_id` come from the PO row, never from the client payload; `pos_receive.company_id` stays NULL. Known gap: `session.userId` is written as sent and is not tied to the authenticated device credentials.
- Over-receive: `evaluateSession` keeps a running total per PO item, so duplicate lines for one item in a session are summed; `excess` is cumulative for the first line and incremental for repeated lines (per item the lines add up to final total − ordered). Replay derives `previousQty` from the memo as `newTotal − qty`.
- Server-function errors: clients get a generic message, details go to the server log with a prefix (`[auth]`, `[pull]`, `[sync]`, `[health]`, `[env]`, `[serve]`). Only `UNAUTHORIZED_MESSAGE` is passed through, detected by string comparison (`data.ts`, `sync.ts`) — change both sides together. `loginOnline` resolves `getDb()` inside its `try` for the same reason.
- Payload limits: push ≤ 200 sessions (`MAX_PUSH_SESSIONS`) and ≤ 5000 lines per session (`MAX_SESSION_LINES`); credentials ≤ 500; pull `limit` ≤ 2000; worklist `limit` ≤ 200. The client sends the oldest 200 outbox sessions per sync.
- `npm start` (`scripts/serve.mjs`) sets `NODE_ENV=production` only if it is unset (a shell `NODE_ENV=development` silently disables the checks), which makes `getPool()` refuse weak `CREDENTIAL_HMAC_SECRET` or unset DB credentials. The refusal happens lazily on the first database request, not at start-up. Changing the secret revokes every cached credential on every device.
- `serve.mjs` reads `TLS_CERT_FILE`/`TLS_KEY_FILE`/`PORT` from the shell environment only (it does not load `.env`; `src/server/env.ts` loads it lazily via `dotenv/config`). Exactly one TLS variable set, or unreadable TLS files, exit the process instead of falling back to http.
- `sync()`, `downloadData()` and `refreshPurchases()` in the store share ONE queue (`runExclusive` in `sync-slice.ts`): a download can never overwrite the `receivedQty` that `markSynced` just updated. Repeated `downloadData()`/`refreshPurchases()` calls join the one already queued/running. `runSync` calls the engine's `refreshPurchases` directly (not the store action) — keep it that way to avoid a deadlock on the queue.
- Every `pull` chunk has a timeout (`PULL_TIMEOUT_MS` in `engine.ts`, option `timeoutMs`), so a hung fetch cannot block the queue forever. Pulls download everything first and swap local tables in one Dexie transaction (`replaceMasterData` / `replacePurchases`), so a timeout or error leaves the old data intact.
- `markSynced` is idempotent and skips the local `receivedQty` increment on `IDEMPOTENT_REPLAY`; the PO list is then refreshed from the server. `runSync` raises the local `meta` flag `purchasesStale` (`PURCHASES_STALE_META_KEY`) BEFORE that refresh and clears it only once the refresh succeeds, so a crash or closed tab mid-refresh still leaves a trace. The flag is also raised when the refresh is skipped (right after a failed push, or when the current user's credential was revoked, because the pull would fail anyway). If the refresh fails, `runSync` tells the operator; it is retried on every later `sync()` and on auto-sync when the device is online again, and any successful refresh/download also clears the flag.
- `syncOutbox` handles the server's answer per session: a local write error (or a failing log write) never reverts a session that is already `SYNCED`, a session the server did not answer for becomes `FAILED` instead of staying `SYNCING`, and `markFailed`/`markRejected` never override `SYNCED`. Answers for an unknown or an already answered session id are ignored (and logged), so `synced`/`failed` never exceed `attempted`. Every `syncOutbox` run first calls `resetStaleSyncingSessions()` (atomic, one transaction): sync runs never overlap, so anything still `SYNCING` is stale and goes back to the queue.
- Code that touches IndexedDB must tolerate running without it (SPA prerender in Node): use `useLive` (`src/client/hooks/use-live.ts`) instead of raw `useLiveQuery`, and `isBrowser()` guards in the store.
- **UI invariants (plans/implementation-plan-ux-refresh-*):** the scan loop must fit 360×640 without
  scrolling; only a successful scan result disappears on its own, the other three scan states wait for
  the operator; undo subtracts the last scanned qty from the line (`addOrIncrementLine` merges repeated
  scans, so `removeLine` would delete too much); `Progress` in `ui.tsx` is kept only because
  `tests/component/ui.test.tsx` asserts its colour classes — new screens use `SegmentedProgress`;
  high-contrast mode is an override layer on `data-contrast="high"`, NOT a light theme, because colours
  are hard-coded Tailwind `slate-*` classes across every component.
- **Session ownership (plans/implementation-plan-pemilik-sesi-mvp.md):** one PDT is shared between
  operators, so `LocalSession` carries the owner's denormalized name (`userFullName`,
  `userLoginId`, backfilled by the Dexie v2 upgrade) and every screen asks
  `src/shared/session-owner.ts` instead of comparing ids — `canEditSession` means "RUNNING AND
  mine", which is what the cockpit's `editable` now is. A non-owner gets `SessionOwnerGate` and
  then a read-only cockpit; the two focus/wedge effects must guard on the same value or a
  read-only screen keeps stealing the scanner. Mind the inverse: the cockpit's `!editable` blocks
  render for a colleague's document as well, so anything in them that WRITES — today the
  "Hapus sesi dari perangkat" button on a REJECTED session — needs its own `isOwner` check
  (`tests/component/session-cockpit-ownership.test.tsx` locks both directions), and their copy must
  not claim that only the owner can send. Sending is deliberately NOT restricted (the outbox
  is device-level), and there is no takeover or purge for a colleague's stranded session. It is a
  mistake guard, not access control: the server never checks the owner.
- **Dedupe per PO (plans/implementation-plan-dedupe-sesi-per-po.md):** `createSession` still checks
  nothing — the rule lives in `findRunningSessionForPurchase` (`src/shared/session-owner.ts`) and is
  applied by its callers, so the ±44 `createSession` calls in `tests/` stay valid. Its scope is
  deliberately narrow and both edges are load-bearing: only `RUNNING` (a PENDING/SYNCING/FAILED
  document for the same PO is a finished one, and a PO may be received in several deliveries) and
  only the current operator's own (a colleague's session for the same PO must NOT block them, or
  they are left with no way to start at all). `routes/pos/$purchaseId.tsx` re-reads
  `runningSessions()` at click time rather than trusting its own `useLive` snapshot, and `busy` plus
  `duplicate !== null` are the only race guards — there is no atomic Dexie transaction. The second
  one matters: `busy` is released the moment the sheet opens, so without it the primary action is
  live behind the scrim. "Buat dokumen baru" must stay: it is
  the escape hatch for a genuine second delivery, and it leaves no trace anywhere.
  `DuplicateSessionSheet` may be a bottom sheet (not a full-screen gate like `SessionOwnerGate`)
  ONLY because the PO detail screen has no scan field and no scanner wedge to steal focus from.
  Three things in that sheet are load-bearing for NF-8 (keypad-first) and each has a test:
  `onKeyDown` lives on the OUTER container (a React handler only sees events passing through its own
  node, so one mounted on the panel alone goes deaf as soon as the focus is elsewhere in the sheet),
  the panel carries `tabIndex={-1}` (a tap on its text would otherwise park the focus on `<body>`,
  where no keystroke reaches any handler and Escape dies), and the scrim carries `tabIndex={-1}`
  (it sits before the panel in document order, so as a tab stop it is the way OUT of the dialog).
  The focus-in effect also restores the previous `activeElement` on unmount — without it every
  cancel drops the operator at the top of the document. `LineEditSheet` in
  `routes/sessions/$sessionId.tsx` is the older twin and still has all four holes.
- **Pick from the PO list (plans/implementation-plan-pilih-item-dari-po.md):** a line can now also
  arrive without a barcode, and both paths end in ONE place on purpose — `addPickedItem` returns the
  same `AddScanResult` as `addScannedItem`, they share `resolveWithConversion` (the conv factor is
  what silently changes a stored qty) and `qtyRejection`, and the cockpit renders both results
  through one `addedHero`, so over-receive cannot be announced by one path only. The qty ADDS, never
  replaces: `addOrIncrementLine` merges a scan and a pick for one PO item into a single row
  (`[sessionId+purchaseItemId]`), which is also why `pickedManually` is sticky and means "part of
  this qty was never scanned" — the only thing that lowers it is undo of the addition that raised it
  (`clearPickedOnUndo` on `lastScanRef`), and the flag never leaves the device, because
  `buildSessionPayload` maps line fields one by one. `ItemPicker` is a full-screen overlay rendered
  BY the cockpit, not a route: the hero card is cockpit state, and the overlay has to switch off the
  cockpit's focus effect AND the scanner wedge — `pickerOpen` belongs in the condition and the deps
  of BOTH, or the picker's search field cannot be typed into at all (it reads as a broken keyboard,
  not as a focus bug). Three of `DuplicateSessionSheet`'s four NF-8 rules apply verbatim; the scrim
  one has nothing to apply to, since the overlay is opaque and has no scrim. The picker's door sits
  in the "+" slot of `ScanBar` while the barcode field is empty, because a fifth 56px button would
  leave that field 80px at 360px — and it is offered on the `NOT_FOUND` card but deliberately NOT on
  `NOT_IN_PO`, where the item is known to be absent from this PO and the picker lists only this PO.

## Repo conventions

- `/plans/` (gitignored) holds internal implementation plans in Indonesian; existing ones show how past features were scoped.
- `.opencode/agents/react-review.md` defines a read-only React review agent built on `npx react-doctor@latest --verbose`; recent "react-review" fix commits come from its findings.
