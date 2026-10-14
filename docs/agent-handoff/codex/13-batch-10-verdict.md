## 1. Verdict

- **Polled-job lifecycle — ACCEPTED.** Jobs start, poll, expire, enforce per-owner limits and idempotency, and preserve cancellation status when late work finishes. The in-memory store does not establish restart durability.
- **Outbox contract and restart claims — ACCEPTED WITH LIMITS.** The source has add, leased claim, done, retry/fail operations, and explicitly says the memory outbox is lost on restart. PostgreSQL behavior and durability remain unverified. The report does not establish that these comments changed in this batch.
- **Non-text 3:1 contrast — ACCEPTED by source review.** The added checks cover the four palettes, control boundaries, focus colors, pressed-state washes, and the accent-card focus override. They are token-based checks, not a browser audit of every rendered control.
- **Albanian self-review — COMPLETE as a self-review.** It records copy candidates without changing strings; native review and approval remain outstanding.
- **Batch verdict — ACCEPTED WITH CONDITIONS.** The scoped work is present, but the client/server job path has not been exercised with live AI, HTTP account isolation remains untested, and neither jobs nor outbox have verified restart durability.

## 2. Source findings

Once the job ID is known, cancellation is honest: the cancel route aborts the job’s controller; `runHandlerAsJob` signals the wrapped handler; the create/adjust handlers pass that signal to plan generation. The HTTP test checks the signal and verifies a late answer leaves the job cancelled.

There is a **cancellation race before the start response returns**. If the caller aborts while `POST /api/jobs/:kind` is still pending, the client has no job ID and returns `aborted` without sending a server cancel. The server may already have started the job. So cancellation works after the start response, but is not guaranteed across the entire client operation.

The idempotency fingerprint uses raw `JSON.stringify(req.body)`. Equal JSON objects with different property order can therefore produce different fingerprints and a `400 KEY_REUSED`. This is a false rejection for a reused key, not a wrong-job result; the normal client retry reuses the same serialized input. Canonicalizing validated input would make equivalent requests robust.

One ruling discrepancy is in the Batch 10 live-call evidence: it records two calls to Groq, including a plan call on `openai/gpt-oss-120b`. The recorded approval specifies `google/gemma-4-31b-it:free` and one synthetic parse plus one short plan, after just-in-time checks. The evidence does not satisfy that approval. It also does not prove a live call through the application’s job path. The report’s narrower statement that no AI route was called is consistent with direct provider calls, but those calls should not be treated as the approved job-path verification.

Current source correctly states that the memory outbox and job store do not survive restart. The PostgreSQL adapter and its fake contract tests do not prove real database behavior. As reported, account isolation was tested at the store level, not over HTTP.

## 3. Next consolidated batch

**Safe before a host is chosen:** address the client abort-during-start race; canonicalize the idempotency fingerprint from validated input; add an HTTP test that verifies two accounts cannot read or cancel each other’s jobs; retain focused memory-adapter checks for the outbox contract. No host-independent test can establish database durability.

**Owner-dependent:** host/database choice and credentials, real PostgreSQL verification and durable job/outbox implementation, real mail provider and sender, and the owner’s native Albanian review.

A live plan through the job path is the most valuable integration check **under the existing one-plan authorization**: use only `google/gemma-4-31b-it:free`; verify zero price and required response-format support immediately beforehand; send one short synthetic plan and make one provider request only, with no retry, fallback, repair, or replacement. Record UTC time, model, endpoint, status, elapsed time, validation result, and available token/cost metadata. Record a refusal as a refusal; never expose the key.

## 4. STATE UPDATE

- **`PROJECT_STATE.md`:** Batch 10 accepted with conditions. In-memory polled jobs implement lifecycle, ownership, idempotency, limits, expiry, and provider-signal cancellation after the job ID is received; cancellation during the start-response race can leave work running. Job and outbox restart durability, PostgreSQL behavior, live job-path behavior, and account isolation over HTTP remain unverified. Non-text token contrast checks and Albanian self-review are complete; native copy approval remains open. Batch 10 evidence records two Groq calls outside the specified Gemma approval.
- **`CODEX_DECISIONS.md`:** Record Batch 10 as ACCEPTED WITH CONDITIONS with the findings above. Next safe batch: close the start-cancellation race, canonicalize validated request fingerprints, and verify account isolation over HTTP; continue memory-only outbox contract checks. Keep PostgreSQL durability, real mail, host selection, and native Albanian review owner-dependent. The existing authorized single synthetic plan check is limited to `google/gemma-4-31b-it:free`, just-in-time zero-price/response-format verification, one provider request, and complete call recording.