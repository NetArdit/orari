## Verdict: Batch 3 accepted with conditions

I inspected both commit summaries, the requested client files, the `/app` server block, the new route tests, and the three journeys. This was a source review: I did not run tests, a build, or a browser. The reported test and browser results remain Claude’s evidence.

The parallel client foundation is within the approved scope, and the old root page and API are not shadowed by the `/app` routes. I found no path in `legacy.ts` that writes to or removes the old keys. The new profile is built from an explicit allowlist, so the password and e-mail do not enter it; the storage schema also strips unknown profile fields. When the signed-in user has a matching copy in the user list, the migration prefers whichever has more plans and uses the signed-in copy on a tie. Duplicate session IDs keep the first occurrence and generate replacements for later ones.

The conditions are data-integrity limits to resolve in the next batch:

- `initialise` checks for an existing profile before its commit. Two tabs can both pass that check, then overwrite each other. Each IndexedDB commit is atomic, but the check plus commit is not.
- `restoreBackup` validates before writing and performs the replacement in one transaction. However, it discovers stale keys before that transaction, so a concurrent plan save may evade the removal. Duplicate plan IDs in a backup also pass validation and collapse to one key during restore.
- The legacy ID repair relies on the ID generator returning unique IDs. A collision with an existing or generated ID can leave duplicates. Unknown legacy status/kind values are silently changed to `pending`/`learning`; that can misstate progress and should be reported or rejected rather than silently normalized.
- “The client cannot be used to read files outside its folder” is tested too weakly: it checks only that the response body lacks `"studyflow"`, not that traversal returns 404 or that a known outside-file sentinel is absent.

These findings do not block pure domain work, but the next batch must address the storage and test gaps before the client relies on concurrent writes, restore, or cutover.

## Eight deviation rulings

1. **Do not migrate e-mail:** accepted. Keep both e-mail and password out of the new store.
2. **Do not store old `stats` or plan `profile` echo:** accepted. Derive statistics from sessions; those fields are redundant.
3. **Unknown legacy status/kind defaults:** accepted only as a temporary compatibility behavior for recognized legacy values. Unknown values must not be silently presented as real progress in future migration logic; report or reject them.
4. **No router dependency:** accepted. The small router is appropriately bounded.
5. **`/app` redirects to `/app/`:** accepted. It is a coherent canonical address.
6. **Narrow `npm test` file pattern:** accepted, provided `test:all` continues to include both server and client suites as reported.
7. **Temporary Albanian status-page copy:** accepted as temporary; it is not approved product copy.
8. **No account-choice screen yet:** accepted for this foundation-only batch. Do not treat “choose” as a successful migration, and do not discard candidate accounts before the product flow is defined.

## Rulings on the three questions

- **Machine-readable API error `code`: yes.** Add a stable code alongside the existing message. At minimum, distinguish unconfigured AI, server busy, provider rate limit, and provider unavailable; use codes for the other error families too where practical. The client should classify by code and status, not by comparing Albanian message text. Keep the message for display.
- **Cutover for a device that already opened `/app`:** take a fresh snapshot of the current legacy data at cutover, after legacy writes are frozen. Re-copy and replace only when the new store still contains migration-only data. If the new app has user-created data, preserve it and reconcile through an explicit merge or backup/recovery path; never silently replace it with the earlier snapshot. Retain legacy keys until the new data and recovery path are verified.
- **Bundle budget:** set an initial cap of **200 kB gzip for the production JavaScript bundle**. The reported foundation is 86.57 kB gzip. Recheck after screens are added; justify any proposed increase with measured output and dependency impact.

## Next batch authorization — Batch 4: client domain and state foundation

**Goal and user value:** Build the tested, deterministic behavior and state layer needed by the new client without choosing or implementing a visual direction.

**Scope:** Pure domain functions, repository/IndexedDB integrity fixes, and a store plus create/re-plan state machines. Include stable API error codes and client classification. Keep these changes in separable commits or clearly separated modules within this batch.

**Expected areas:** `client/src` domain, storage, API and state modules and their tests; server error responses and route tests for the additive error codes; migration and restore tests; the `/app` traversal test. Add `.ics` export only as a pure domain function that does not require a screen.

**Explicit exclusions:** No planner screens, design tokens, base components, visual copy decisions, live AI calls, paid services, push, or deploy. Do not remove legacy keys or perform cutover.

**Architecture and approach:** Keep domain rules as pure functions; keep state transitions independent of React and inject the API/repository for tests. Make initialization and backup restore safe against concurrent tabs and malformed/duplicate IDs. Preserve the existing versioned IndexedDB model and the old page during coexistence.

**Domain-rule checkpoint:** In the batch report, propose and explain definitions for completed and missed sessions, streaks, “today,” and the next session. Tie them to stored session statuses and dates, include boundary examples, and identify where old-page behavior is inconsistent. Implement the rules as named pure functions so they can be reviewed and changed without UI work. Do not present an inferred rule as established product policy.

**Acceptance criteria:** The report identifies all changed files and evidence; the client API maps errors using stable codes; timeout and cancellation outcomes stay distinct; repository initialization and restore preserve all data on failure and concurrent operations; duplicate backup and generated IDs cannot silently collapse records; migration never modifies legacy keys; the state store rolls back failed optimistic writes and prevents stale async results from overwriting newer state; create/re-plan flows cover cancellation, failure and success; routes reject hostile input safely; and the traversal test asserts status and a meaningful outside-file sentinel. Run the appropriate unit and integration tests and report exact results. Do not run live AI requests.

**Risks and recovery:** Storage changes can affect migrated user data. Keep the legacy keys intact, make storage writes transactional, test failure and concurrency cases, and provide a backup/recovery route before any later cutover.

## STATE UPDATE

Workspace is read-only, so I did not edit the records. Suggested lines:

**`PROJECT_STATE.md`**

> Batch 3 (client foundation at `/app`) accepted with conditions: resolve cross-tab initialization/restore races and duplicate-ID handling before relying on concurrent writes or cutover; strengthen the traversal assertion. Source review only; reported tests/build/browser results were not independently rerun. No visual screens may be built until the owner selects a design direction. Batch 4 authorized for pure client domain logic, storage integrity, state flows, and stable API error codes; no visual work.

**`CODEX_DECISIONS.md`**

> Batch 3: ACCEPTED WITH CONDITIONS. Source inspection confirmed legacy migration is read-only and excludes password/e-mail from the new profile; `/app` is mounted without changing `/` or `/api`; status classification currently depends on server message text. Conditions for Batch 4: make initialization and restore safe under concurrent tabs; reject/report duplicate backup IDs and avoid generated-ID collisions; do not silently normalize unknown legacy statuses; strengthen the traversal test. Add stable machine-readable error codes and classify from codes/status. Cutover must snapshot current legacy data after writes freeze, replacing only migration-only new storage; preserve and reconcile any new-client data. Initial production JavaScript budget: 200 kB gzip. Batch 4 authorized without UI; propose explicit completed/missed/streak/today/next-session rules in the batch report.

