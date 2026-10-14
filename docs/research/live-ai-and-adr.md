# Batch 6, deliverables 3 and 4: live AI timing, and the architecture decision record

## 3. Live AI (the two authorised calls)

Raw record: `docs/agent-handoff/evidence/batch-6/live-ai.json`. Script: `live-ai.mjs` beside it.

**Before calling** (public list at https://openrouter.ai/api/v1/models, 2026-10-14 01:06 UTC, 462 models listed, 14 of them free):

| Model id in `lib/ai.js` | Listed? | Price (prompt / completion) |
|---|---|---|
| `z-ai/glm-5.2:free` (the primary) | **not listed** | n/a |
| `google/gemma-4-31b-it:free` | yes | 0 / 0 |
| `dots-studio/dots-3-note-preview:free` | yes | 0 / 0 |
| `liquid/lfm-2.5-2.6b:free` | yes | 0 / 0 |

So the app's first-choice model no longer exists on OpenRouter and the fallback chain has been silently covering for it. The model for the calls was chosen as `google/gemma-4-31b-it:free` (listed, priced 0 and 0, 262,144-token context, the largest-context of the three that are listed and instruction-tuned).

**Result.** Two provider requests were made, one parse and one plan, each by one request with the app's own prompt and JSON mode and with the app's retry and repair logic prevented from reaching the provider.

| Call | Started (UTC) | HTTP | Elapsed | Outcome |
|---|---|---|---|---|
| parse | 2026-10-14T01:06:52.672Z | **429** "Provider returned error" | 826 ms | no completion |
| plan | 2026-10-14T01:06:53.501Z | **429** "Provider returned error" | 359 ms | no completion |

**Both calls were refused by the provider before any generation.** Consequently:
- **No generation latency was measured**, and nothing about the validity of the model's JSON against the app's schemas was learned. The elapsed times above are the time to a refusal, not a measure of the model.
- INFERRED, not verified: "Provider returned error" with 429 on OpenRouter commonly means the upstream provider that serves the free model is itself rate-limited, not that this key is exhausted. Nothing in the response confirms which.
- The authorisation covered exactly two calls; both are spent. **No further call has been made.** A different free model, or the same one later, is a new request to Codex.
- Zero cost held: both requests were refused and the model is priced 0 and 0.
- The key was not printed or recorded; a search of the result file for the key prefix found nothing.

## 4. Architecture decision record: accounts and hosting

Status: **proposed**, awaiting Codex's review of this batch. Decisions already ruled by Codex on 2026-10-14 (`codex/08`) are marked RULED; new findings change the status of some.

| # | Decision | Status | What this batch added |
|---|---|---|---|
| Q1 | PostgreSQL as the only SQL engine behind a small repository interface; numbered SQL migrations; no ORM; in-memory implementation for logic tests; a real-Postgres suite before release | RULED | Neon Free is permanent and card-free, 1 GB, but suspends after 5 min and keeps 6 h of history: a scheduled dump and the export feature are required. Render's free Postgres (30-day expiry) is excluded. |
| Q2 | Hosting | **OPEN** | See below. |
| Q3 | Built-in scrypt, N=2^15 r=8 p=3, parameters in the hash, concurrency cap; **minimum length 15**, no composition rules, known-compromised password check | RULED | Not benchmarked on a candidate host yet (272 ms and about 32 MB on this machine). The compromised-password source is undecided: a k-anonymity range API call sends a 5-character hash prefix to a third party and must be disclosed; an offline list costs disk. |
| Q4 | Opaque cookie sessions, hashed at rest, 30-day idle and 90-day absolute expiry, Origin checks, device list and revoke | RULED | none |
| Q5 | Uniform reset response, single-use 30-minute hashed token, sessions revoked after reset, e-mail verified before sync and AI use | RULED | **Brevo's limits could not be read**; Render blocks SMTP so the provider must be used by its HTTPS API; a test mail adapter in development. |
| Q6 | PostgreSQL authoritative, IndexedDB a cache, idempotent mark operations with explicit conflict rules, queued offline marks | RULED | Needs its own specification (below). |
| Q7 | Explicit one-time import of this device's plans | RULED | none |
| Q8 | Export, deletion, privacy notice, AI-provider disclosure, retention, incident procedure | RULED, **expanded** | The law's age of digital consent is 16 (Art. 7) and transfers abroad need an adequacy decision (Arts. 44 to 47). These are open questions for the owner, not engineering details. |
| Q9 | `layoutStyle` and `colorMode` stored values; default notebook + system | RULED | Names: see design research, section 6. |

### Q2, hosting: what the evidence leaves

- Netlify cannot hold the 75 s call synchronously (60 s). It can run a **background function** (15 min, 256 KB payload), which fits a job design.
- Vercel Hobby fits 75 s (300 s limit) but is **non-commercial only**, and the owner's intent for Orari (a product "for students", possibly a paid one later) is not known.
- Render and Koyeb are always-on containers that **sleep**; they fit a held request but add a cold start of about a minute, ephemeral disks, and (Render) blocked SMTP.
- None of these was tried. **Whether an Express app deploys unchanged on any of them is not verified.**

My recommendation, labelled engineering judgment: design plan generation as a **job with polling** regardless of host. It removes the dependency on any host's request limit, survives a phone going to sleep, lets the page show honest progress and a Cancel, and lets the rate limit count jobs. Its costs are a jobs table and recovery of jobs interrupted by a restart. The decision still needs real latency numbers: if a plan takes 8 s on a model that works, a held request is simpler.

### Q6 specification still to be written

Session-mark conflicts: each mark carries a client-generated operation id (idempotent), the status, and the base revision of that session; the server keeps a per-session revision and accepts the mark if it is newer than what it holds by that revision, otherwise answers with the current state and the client shows it. Client clocks are not used for ordering. Offline queue states: pending, synced, failed with a retry. To be written in full, with tests, before implementation.

### What blocks what

| Gate | Blocks | Needs |
|---|---|---|
| Real model latency and JSON validity | job-versus-request decision; model list | a second authorised attempt |
| Hosting choice | all deployment work; Brevo integration; Neon region | the facts above plus the owner's constraints (commercial or not, audience) |
| Audience and ages | sign-up design; consent; AI disclosure | owner |
| Brevo limits | reset flow delivery | owner reads their dashboard |
| Compromised-password source | sign-up validation | a decision on a third-party call versus an offline list |
