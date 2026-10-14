## 1. Batch 4 verdict

**ACCEPTED WITH CONDITIONS.** The code is a useful, separable foundation, but fix the issues below before screens rely on it.

I verified the recent commits and inspected the requested server, client, storage, domain, state, and test files. This was a **source review only**: I did not run tests, a build, or a browser. I have not independently verified Claude’s reported test results.

- **IndexedDB `commit`:** Preconditions are checked in the same read/write transaction as the writes. Chained `getKey` callbacks issue the writes before the transaction can complete; an explicit refusal aborts with the saved `PreconditionFailedError`. `deletePrefix` gets its keys inside that transaction and issues deletions from the request callback. This supports the reported atomicity, though the cross-tab race itself was not independently exercised here.
- **Repository:** `initialise` validates duplicate plan IDs and atomically checks that no profile exists. `restoreBackup` validates the backup, counts malformed and duplicate plans, and replaces plan keys using a prefix deletion inside the transaction. Restore intentionally replaces the profile and plans. A save from another tab that commits *after* restore can still appear alongside the restored plans; the current transaction only makes the replacement atomic at its commit point.
- **Legacy migration:** `fresh` avoids IDs already in use and stops after 50 collisions. Unknown status and kind values are counted only for plans that pass validation and are carried over.
- **State flows:** The run ID makes cancelled or superseded answers stale; cancel and reset abort and immediately return to idle. Re-planning waits for writes already queued, then reads the latest plan. The per-plan queue and rollback maps look consistent for marks, saves, and deletes issued through this store.
- **Two gaps need correction before use:** `planFromAnswer` generates a plan ID without checking existing plans, and `repository.savePlan` can overwrite a same-ID plan. The “no generated-ID collision” condition is therefore not fully met. Also, `.ics` escapes summaries and descriptions but inserts the session ID into `UID` unescaped; stored IDs can contain newlines, allowing malformed or injected content.
- **Tests:** The stable-error-code test checks sampled route responses and cross-checks literal codes against the published list. Its name overstates its runtime coverage: the source scan does not prove every error path was exercised. The traversal test is stronger: it creates a readable sentinel outside the client folder, uses raw HTTP requests for ten traversal forms, and checks both the body and response class.

### Five deviations in section 9

1. **`BAD_REQUEST`: accept.** It is a sensible additive code for Express-rejected requests and is published and classified.
2. **One `provider_unavailable` client kind for provider rate limits and unavailability: accept.** Their stable server codes remain distinct, and a shared retry-later handling category is reasonable.
3. **New Albanian strings: defer to the copy pass.** They are not approved copy.
4. **No stored `stats`: accept.** This matches the earlier ruling.
5. **Removed unused code/parameter: accept.** No scope concern from the report or source.

## 2. Proposed domain rules

These are approved as **working client rules for domain tests and later screen work**, not as settled product policy where noted.

- **Today:** accept device-local calendar date; the plan stores floating local dates and times.
- **Session state:** accept the person’s mark taking precedence. For unmarked sessions today, use the half-open interval `[start, end)`: upcoming before start, now from start until end, late from end until midnight, then missed on the following day. `late` and `now` are useful distinctions; their eventual labels and actions remain product choices.
- **Completed and partly done:** accept separate counts; partial is not completed. Accept the proposed half-weight for completion and minutes as a working rule. The odd-minute rounding is explicit in code (`Math.round`); retain it only as a documented approximation, not a claim of exact minutes.
- **Missed and skipped:** accept missed as unmarked after the scheduled day; skipped is a separate deliberate mark, not a lapse.
- **Needs re-planning:** accept an unended plan with at least one missed session. A skipped session alone or a session merely late today does not trigger it.
- **Streak:** accept the proposed algorithm as a provisional rule: done or partial study days count; a planned day with no study breaks the streak; days with nothing planned neither count nor break it; an unfinished today is ignored. **Whether partial counts toward a streak goes to the owner** before the rule is presented as product policy.
- **Next session:** accept the in-progress unmarked session first; otherwise the earliest unmarked upcoming session. Late sessions remain in today’s agenda, not “next.”
- **Current plan:** accept the most recently created plan whose end date is today or later.

Of the three product questions:

1. **One-tap move for a late session:** owner decision.
2. **Partial sessions count toward streaks:** owner decision.
3. **Skipped sessions feed the re-plan prompt:** retain the old page’s behavior provisionally and include skipped sessions in the missed summaries, as implemented. Confirm with the owner before presenting this as policy; it is a product-facing consequence.

## 3. Albanian strings

Defer the new strings in `planForm.ts` and `flows.ts` to the copy pass, including the plan-created-but-not-saved message. They should receive a Kosovo Albanian review together rather than piecemeal technical edits. I did not make wording changes.

## 4. Server finding: re-plan can schedule earlier today

**Confirmed.** `/api/adjust-plan` passes `progress.today` as the calendar start date, but no current time. `buildCalendarOrError` builds the entire day from the existing free windows; those windows are bounded by the server’s 06:00 floor, not the person’s current time. Sanitization verifies a proposal fits those windows, so an 08:00 session can survive an answer received at 18:00.

**Approve the fix:** add a validated client-local current time to the adjust request and clip today’s free windows at that time before validating AI sessions. Preserve the existing date-only behavior for older clients if compatibility requires it. Keep `alreadyOver` as a defensive client count.

## 5. Next batch — Batch 5

**Goal and user value:** Close the remaining data-integrity and scheduling gaps before any screen uses these flows.

**Scope and expected files:** `lib/schema.js`, `lib/app.js`, `lib/time.js` and related server tests; `client/src/domain/replan.ts`, `client/src/domain/ics.ts`, `client/src/state/flows.ts`, `client/src/storage/repository.ts` and their tests; IndexedDB browser journey files for a real two-tab check; `client/src/domain/planForm.ts` only if needed to make its semantic validation behavior explicit.

**Approach:** Make new-plan creation collision-safe against existing plans, including concurrent tabs; do not overwrite an existing plan merely because its ID collides. Escape or safely constrain the calendar `UID` value. Add the current local time to re-planning and clip today’s availability before sanitizing results. Exercise initialize and restore races in two real browser tabs. Check and document forms that pass schema validation but yield no schedulable time, such as all plan dates marked unavailable.

**Explicit exclusions:** No screens, visual direction, design tokens, components, live AI calls, push, deploy, actual cutover, or PDF dependency. Do not remove legacy keys. Do not add broad storage recovery or backup UI in this batch.

**Risks:** A plan-ID change affects creation and storage semantics; use an atomic no-overwrite condition for new plans while preserving intentional updates to existing plans. Current-time scheduling must use the client’s local date and time consistently. Calendar export must not allow stored text to create extra content lines.

**Acceptance criteria and required tests:** Test generated plan IDs against existing IDs and concurrent creation; prove a collision cannot replace existing data. Test `UID` escaping for CR/LF and special characters. Test re-planning when the current time is before, during, and after free windows, and verify that earlier-today sessions are rejected. Run an actual two-tab initialize and restore/save journey in IndexedDB. Test and report the no-schedulable-time form case. Claude should report exact commands and outcomes; none are verified by this review.

**Recovery:** Keep the changes in separable commits. If the ID or scheduling changes fail their checks, revert those commits without changing the existing storage schema or removing legacy data.

PDF extraction groundwork is **not approved in Batch 5**. It remains a possible Phase 4 task, but first provide measured install/disk impact, license confirmation, build and worker setup, and bundle impact for `pdfjs-dist`. Keep extraction browser-side, bounded, without OCR or a live model call; report memory and file-size limits before implementing it.

**The project should not wait for the owner yet.** Visual screens remain blocked until the owner selects a direction, but Batch 5 has useful non-visual correctness work that does not depend on that choice.

## 6. State update

I could not edit the records because this workspace is read-only. Suggested lines:

**`PROJECT_STATE.md`**

> Batch 4: ACCEPTED WITH CONDITIONS by source review. IndexedDB commit checks and prefix deletion are transaction-scoped; domain rules are approved as working rules, with streak and interaction policy still requiring owner confirmation. Before screens use the foundation, fix new-plan ID collision/overwrite risk and escape calendar UIDs. Re-plan’s server calendar currently includes earlier times today; Batch 5 is authorized to add client-local current time and clip today’s windows. Reported tests/build/browser results were not independently rerun. No visual work until the owner selects a design direction.

**`CODEX_DECISIONS.md`**

> Batch 4 verdict: ACCEPTED WITH CONDITIONS. Source review confirms transactional precondition checks and in-transaction `deletePrefix`; actual two-tab behavior was not independently verified. Conditions: make new-plan creation collision-safe without overwriting an existing plan; safely encode the ICS UID; add client-local current time to adjust requests and exclude earlier-today windows. Accept session state, progress, re-plan, streak, next-session, and current-plan definitions as provisional domain behavior. Owner decisions remain for late-session actions, partial streak credit, and whether skipped sessions prompt re-planning. Batch 5 authorized for these fixes and real two-tab browser checks only; no visual work, live AI, cutover, or PDF dependency.