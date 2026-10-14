## Batch 2 verdict: accepted with one evidence condition

I checked the source paths, the relevant commit diffs, the reported journey results, and the test assertions. I did not run tests or a browser; the test counts, mutation results, and browser runs remain Claude’s evidence.

The implementation fixes match the reported scope. The server changes are focused on the authorized defects and controls. The README and Node 22 conditions were addressed. The new dependencies are limited to the approved middleware.

The re-plan fix has two parts: it looks up the plan in the same user object it persists, then keeps past sessions and all non-pending sessions while replacing pending sessions from today onward. The journey result records all 14 checks passing, including that the plan was saved and the marked sessions remain. I verified that from the source and result file; the journey script itself has one evidence weakness described below.

### Per-item findings

- **Impossible dates:** The date schema checks that a date formats back to its input, preventing rollover dates such as February 31.
- **UUIDs:** Server-generated session IDs use `randomUUID()` and remain strings.
- **Session sanitization:** Sessions are sorted by date and start time. Because each kept session is non-overlapping with the previous kept session, comparing only the last kept session is sufficient: any still-earlier kept session ends no later than that one starts. Overlaps with a dropped session do not constrain later candidates. The current deterministic rule keeps the earliest start; ties sort by earlier end. Sessions under 20 minutes are dropped; touching sessions are allowed.
- **Dropped sessions and empty plans:** The server reports the number dropped and returns an error if none can be kept. Adjust requests also reject a finished plan and a remaining period with no free capacity.
- **Overnight commitments:** The evening interval applies to the commitment’s start date and the morning interval to the following date. A sleep commitment suppresses default sleep only on a date when that commitment starts; an overnight sleep from the prior date still blocks its morning interval. That gives the reported behavior for both recurring and date-limited commitments.
- **Time normalization and field errors:** `9:00` is normalized to `09:00`; daily availability windows must end after they start, while overnight commitments remain allowed. `24:xx` is rejected. Validation details are mapped to field paths and Albanian messages.
- **Rate limiting, concurrency, and headers:** The limiter covers the three AI routes. The concurrency slot is released on response finish or close, with an idempotent release function, so both events cannot decrement twice. A validation response still releases the slot. The Helmet policy allows the page’s self-hosted scripts, inline styles, and Google Fonts, while omitting HSTS and insecure-request upgrades for local HTTP use.
- **AI deadline and abort:** One timeout signal covers the whole JSON call, including fallback, retry, and repair attempts. Caller aborts and deadline aborts are mapped separately. The request close handler aborts AI work if the response has not ended. Source inspection found no double-release path or apparent listener/timer leak.
- **Client-local date:** `/api/parse` accepts and validates `clientDate` and `timeZone`; the legacy page sends both. `/api/adjust-plan` already receives a validated `progress.today`.
- **Re-plan on the legacy page:** The handler now mutates and persists the same user object. It preserves all marked sessions and replaces pending sessions today onward.

One test-name overclaim needs correction: the browser journey checks that the completed and missed summary arrays have lengths of four and two, respectively, but those checks do **not** compare the expected summary contents. The saved result JSON shows the expected contents for this run, and the merge itself has separate assertions, but the harness would still pass if the summaries were wrong but had the right lengths. Please strengthen those assertions to compare the exact expected arrays before using the journey as a behavior-mapping baseline. This is an evidence condition, not a source-level defect in the re-plan fix.

## Deviations and policy rulings

I accept all eight reported deviations:

1. **No timezone field on adjust:** Accepted. `progress.today` already carries the client’s explicit local date, and the adjust handler does not derive a date from the server clock. Adding an unused timezone field would not change behavior.
2. **No plausibility bound on `clientDate`:** Accepted. The field is validated as a real date and only informs parsing; rejecting a valid date because a device clock differs could block legitimate use.
3. **Reversed availability windows rejected:** Accepted. They were already identified as a defect and now get a field-level error. Commitments can still cross midnight.
4. **Overlap survivor rule:** Accepted. Keeping the earlier-starting session, then the earlier-ending session on ties, is deterministic and straightforward.
5. **`24:30` fixed with the time normalization work:** Accepted; it is the same validation boundary.
6. **Parse request change in a separate client commit:** Accepted. That keeps the change independently reversible from the re-plan repair.
7. **Re-plan save defect:** Accepted as necessary to make the already-approved re-plan fix work. The journey surfaced a real behavior missed by both source audits.
8. **Stopping processes during the hung mutation run:** No code or project data change is reported. I cannot independently confirm the process identity or restart, but this does not change the Batch 2 verdict.

I accept the defaults of **30 AI requests per address per 10 minutes, four AI requests in flight per server process, and a 75-second whole-job deadline**. They are configurable at the app/AI boundaries and reasonable starting limits without usage data. Keep the documented limitations visible: the limiter and concurrency cap are process-local, school networks share an address bucket, and reverse-proxy deployments need correct proxy configuration.

## Albanian copy

The messages are understandable, but I recommend a copy pass before they are treated as final Kosovo Albanian. In particular, **“sesion”** is less natural here than **“seancë”**, “Kjo fushë mungon” sounds translated, and the time-format instruction should tell the person what to do.

Suggested copy:

- `1 seancë e propozuar nga AI u hoq, sepse nuk përshtatej me kohën që ke të lirë.`
- `N seanca të propozuara nga AI u hoqën, sepse nuk përshtateshin me kohën që ke të lirë.`
- `AI nuk arriti të vendoste asnjë seancë në kohën që ke të lirë. Provo përsëri.`
- `Ky plan ka përfunduar dhe nuk ka më ditë për ta rregulluar. Krijo një plan të ri.`
- `Nuk ka mbetur kohë e lirë deri në fund të planit. Zgjate afatin ose shto më shumë kohë të lirë.`
- Keep the rate-limit message, with `Prit pak minuta dhe provo përsëri.`
- Keep the busy-service and AI-delay messages; both read naturally.
- `Shkruaje orën në formatin 08:30.`
- `Koha e përfundimit duhet të jetë pas kohës së fillimit.`
- `Zona kohore nuk është e vlefshme.`
- `Plotëso këtë fushë.`
- For generic field errors, prefer `Vlera e dhënë e kalon kufirin e lejuar.` and `Vlera është nën minimumin e lejuar.`

These are copy recommendations, not a request to reopen the Batch 2 logic.

## Batch 3 authorization

**Goal and user value:** Build the client foundation needed to migrate safely, with typed API and storage boundaries and a verifiable migration path. Keep the existing planner available while the new client is built.

**Scope:** Extend the legacy browser journey to cover plan creation and assert the exact re-plan progress summaries. Add `client/` with Vite, React, Tailwind, strict TypeScript, a typed API client, versioned IndexedDB storage, the legacy-data migration, a router, and a production build. Serve the new client at **`/app`**; keep the existing page at `/` as the default during coexistence.

Use **Vitest** for client tests. It shares Vite’s config and transform pipeline and supports TypeScript/JSX, which fits this client without maintaining a second test setup. [Vitest’s official feature guide](https://vitest.dev/guide/features), [configuration guide](https://vitest.dev/config/). Keep the existing `node:test` suite for the server. For this batch, keep Vitest tests in the Node environment where possible; use the existing Edge journey for browser behavior rather than adding another browser or DOM-testing stack. Use the current official Vite and Tailwind installation guides when selecting compatible versions.

**Storage ruling:** Migrate the profile and plans into the new versioned store, but do not migrate the password. Preserve the legacy `studyflow_*` keys while the new app is in parallel and until the migration is verified and cutover is approved. At cutover, remove the legacy keys, including the plaintext password, as part of the same transition. Do not silently delete them during the initial copy.

**Acceptance criteria:** The legacy plan-creation and re-plan journeys pass with exact assertions; migration tests verify profiles and plans round-trip without a password; the API client covers field errors, abort, and timeout behavior; the production build is served at `/app` with SPA routing while `/` still serves the legacy page; existing server behavior and APIs remain intact. No live AI calls.

**Exclusions:** No broad planner UI implementation before the owner selects a design direction; no flashcards, deployment, push, paid service, or live provider use.

**Dependencies, size, and risk:** Keep the dependency set minimal. Yes, report the added dependency footprint, client production bundle size, disk use, and peak build memory against the machine’s roughly 4 GB RAM and 2 GB free disk. Measure first; I am not setting an arbitrary size ceiling before seeing the actual footprint.

**Recovery:** Keep the old client and legacy keys available throughout coexistence. The `/app` mount and client foundation should be independently removable without changing the API or legacy root page.

## Design directions

Before sending them to the owner, I want the two directions to show the **same content and comparable screens**: today/dashboard, a week plan, plan creation or availability setup, and a session detail. Include empty and error/AI-unavailable states, with coherent light and dark themes. Show the same realistic student scenario at matching phone and desktop sizes so the owner can compare layout and hierarchy directly. Keep the product name undecided.

I recommend that I review the finished static directions **before** they go to the owner, then send them together for selection.

## STATE UPDATE

I can’t edit the records in this read-only workspace. Suggested lines:

**`PROJECT_STATE.md`**

```text
Gate: Batch 2 ACCEPTED WITH EVIDENCE CONDITION. Source review confirms the reported correctness and reliability fixes. Condition: strengthen the re-plan browser journey’s progress-summary checks to compare exact expected contents, not only array lengths. Tests, mutation results, and browser execution remain Claude-reported, not independently rerun.

Batch 3 authorized: Vitest for client tests; serve the new client at /app while the legacy page remains at /; migrate profile and plan data into versioned IndexedDB without passwords; retain legacy studyflow_* keys until verified cutover, then remove them with the plaintext password. Report dependency footprint, bundle size, disk use, and peak build memory. No live AI calls or broad UI before owner selects a design direction.
```

**`CODEX_DECISIONS.md`**

```text
2026-10-14 — Batch 2 ACCEPTED WITH EVIDENCE CONDITION: strengthen the re-plan browser journey to assert exact completed/missed progress summaries. Accept Batch 2 policy defaults: 30 AI requests/address/10 min, 4 concurrent AI jobs/process, 75 s overall AI deadline. Accept no adjust timezone field because validated progress.today already supplies the client-local date. Batch 3: use Vitest; serve the new client at /app with legacy root retained; migrate profiles/plans to versioned IndexedDB without passwords; retain old keys through coexistence and remove them at verified cutover. Report resource footprint. Codex reviews both static design directions before owner review.
```

