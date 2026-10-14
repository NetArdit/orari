# Verdict on Batch 6

The two clear shortfalls are **design research** and **live AI**. The report correctly says so: the captures show marketing pages rather than in-app use, and the two authorized calls were refused before generation. The architecture record is useful, but remains proposed where it depends on those missing facts.

**Hosting, accounts and law — partially accepted.** The hosting comparison is useful: it dates the research, names source pages, and marks several gaps. It does not support a final host choice, and the legal section needs correction before it can guide implementation.

**Design — not accepted as complete.** The three usable captures are marketing pages; there is no in-app evidence, phone-width observation, or revision of either direction. The report’s restraint in not presenting the mock-ups as research-driven is right, but the requested design deliverable remains outstanding.

**Live AI — not achieved.** Both requests received 429 responses. Those timings measure refusals, not model latency, and no output was validated against the app’s schemas.

# Hosting and plan generation

From the evidence gathered:

- **Netlify survives for an asynchronous job design.** Its documented synchronous 60-second limit is below Orari’s 75-second AI deadline. Background functions can run up to 15 minutes, with a 256 KB background payload limit. That does not establish that Orari’s Express app deploys there unchanged or that its background execution fits the chosen job design. [Netlify function limits](https://docs.netlify.com/build/functions/configuration/)
- **Vercel Hobby survives only if the project is genuinely non-commercial.** Current official docs list a 300-second Hobby function maximum when using Fluid Compute, enough on paper for 75 seconds; Hobby is restricted to non-commercial personal use. Express compatibility and practical deployment remain unverified. [Vercel function limits](https://vercel.com/docs/functions/limitations), [Hobby plan](https://vercel.com/docs/plans/hobby)
- **Render Free can run a server, but I exclude it as the production accounts host under the present constraints.** It sleeps after 15 idle minutes, takes about a minute to wake, has ephemeral files and no persistent disks; its free Postgres expires after 30 days. Render itself says its free services are for testing and hobby projects, not production. SMTP is blocked, though HTTPS mail APIs remain possible. [Render Free services](https://render.com/docs/free)
- **Koyeb remains unverified, not selected.** The report found conflicting free-tier information, and the service’s limits and production suitability still need confirmation.
- **Neon remains a database candidate, not a hosting decision.** Its reported one-gigabyte storage and six-hour restore history do not establish an adequate backup plan. Current Neon material confirms its free tier’s one-gigabyte storage and 100 CU-hours, but those terms must be checked again before any deployment choice. [Neon Free plan update](https://neon.com/blog/neon-free-plan-1-gb-per-project)

Before choosing, establish the owner’s commercial intent, target audience/location, acceptable wake-up behavior, actual Express compatibility, database region/connection limits and backup procedure, outbound email route and free-tier shutdown/usage behavior. The present evidence does not identify a complete, dependable, zero-cost production stack for real accounts.

**Plan generation:** I approve a **host-independent polled-job API contract** as the default design, with durable job state in PostgreSQL. A phone or tab may go idle during a long generation, and Netlify’s synchronous limit already rules out the current held request there. The job runner and recovery mechanism still depend on the host. Do not claim Cancel works unless the implementation can stop or safely mark a running provider request. The measured latency from the newly authorized calls below can refine the execution design, but a short response alone would not remove the mobile-lifecycle and host-timeout concerns.

# The law

This is **not yet adequate as engineering research for an implementation or launch decision**. It is a useful issue list, but the report says the law text was only read through the first 100,000 of 162,873 characters. It therefore has not established the full transfer framework or penalties.

Two conclusions need narrower wording:

- **Under 16:** Article 7 applies where processing relies on consent for an information-society service offered directly to a child. In that case, the law sets 16 as the age at which the child can consent independently; below 16, parental consent or authorization is required, with verification efforts specified in the article. This is **not a general minimum age for using Orari** regardless of the lawful basis. [Kosovo Law No. 06/L-082, Article 7](https://gzk.rks-gov.net/ActDocumentDetail.aspx?ActID=18616&lang=en)
- **Cross-border transfers:** Articles 44–47 make adequacy a central route, but the report’s “only” formulation is too strong. Article 49 describes other grounds for which the Agency may authorize a transfer, including informed consent, and says transfer under that route requires Agency authorization. The report has not established whether any route applies to Orari or its providers. Do not treat user consent alone as a settled solution. [Kosovo Law No. 06/L-082, Articles 44–49](https://gzk.rks-gov.net/ActDocumentDetail.aspx?ActID=18616&lang=en)

The three questions in section 5 should go to the owner now:

1. Who is Orari for: age ranges, countries, and public product or portfolio?
2. Will it process real students’ data, or only test-account data?
3. Is legal counsel or relevant Agency guidance available before public use?

The next legal pass should read the whole relevant law, check amendments and Agency guidance, and keep legal interpretation explicitly unresolved until qualified advice is available. The AI transfer claim should also be conditional: a prompt is a transfer concern if it contains personal data and is sent to a recipient abroad; the report does not establish every recipient’s location or processing terms.

# Live AI and model list

The two original calls are spent. I authorize **one fresh parse call and one fresh short-plan call**, using `google/gemma-4-31b-it:free`, which the current OpenRouter catalog lists at zero prompt and completion price and as supporting `response_format`. Reconfirm the model ID and both zero prices immediately before calling. [OpenRouter model catalog](https://openrouter.ai/api/v1/models)

Limits: synthetic inputs only; exactly one provider request per operation; no retry, fallback, repair request, or replacement call if either receives an error. Stop if zero cost cannot be confirmed. Record a refusal as a refusal, and report latency or schema validity only if a completion is actually returned. The attempt does not depend on the hosting choice.

**Replace the stale model list (P2-9).** This is a small, host-independent server change and should proceed. Remove the unavailable primary; make the allowed model list explicitly configurable and validate its local shape at startup. Do not add a required live catalog request to application startup: that would make boot depend on OpenRouter availability. Do not add a paid fallback.

# Design and names

The existing research is **not enough to revise the two directions**; the in-app evidence pass should come first. The screenshots and notes are honest about their limits, but marketing pages cannot establish planner interaction patterns.

Count as in-app evidence: direct observation of current product screens and interactions, preferably through a free account at phone width, with dated screenshots or precise interaction notes. Public product walkthrough videos and official help pages can supplement that evidence if access is unavailable; label them as secondary evidence and mark inaccessible states as gaps. Capture comparable Today, week, onboarding, empty, loading, and error states where the products expose them. Do not infer behavior from a hero image.

I accept **Blloqe** over **Tabelë** for the second direction. It matches the already ruled stored value `blocks`; display labels can still be reviewed after the paired directions are revised. Keep stable values separate from labels.

# Compromised-password source

Use Have I Been Pwned’s **Pwned Passwords range API**, with a SHA-1 hash of the complete password computed locally and only its first five characters sent. It is free, requires no API key, and returns the matching suffixes for local comparison. Do not query on each keystroke; query once after the user finishes entering the password. Tell the user that a privacy-preserving third-party check is used, and do not log or retain the prefix or returned range. The API supports optional response padding. [HIBP Pwned Passwords API documentation](https://haveibeenpwned.com/API/V3)

I prefer this over storing a large offline corpus on a machine with about 930 MB free disk. The API outage behavior still needs specification: report an unavailable check honestly and do not silently treat it as a clean result.

# Next batch — Batch 7

The owner prefers fewer, larger cycles. Batch 7 should combine the design work with the bounded groundwork that does not depend on a hosting choice, while keeping the larger account implementation out of scope.

- **Goal and user value:** finish the evidence needed to design both planner styles, unblock planner screens, and close safe configuration and persistence groundwork.
- **Scope:** complete the in-app evidence pass and revise paired directions; then implement the agreed initial planner screens and both layout settings. Add the `layoutStyle`/`colorMode` settings contract using existing client storage. Update the AI model configuration and defaults per this ruling. Define a narrow accounts repository interface with an in-memory implementation for domain logic.
- **Expected areas:** `docs/research/design-research.md` and dated captures/notes under `docs/research/shots/`; `client/src` planner, settings, and storage code; `lib/ai.js` and its configuration/tests; a small server accounts repository module and focused tests.
- **Approach:** gather evidence first, revise both styles across comparable phone-first flows and light/dark/system modes, then implement screens against those directions. Keep account persistence behind the interface so a PostgreSQL adapter can follow.
- **Explicit exclusions:** no host choice or deployment, PostgreSQL driver/migrations, account routes or authentication, real email delivery, legal-compliance claim, external service credentials, paid dependency, push, or publishing. Do not read `.env`.
- **Acceptance:** research claims carry a source and date, gaps and inferences are distinct, and both styles cover the same flows. Both styles and appearance settings work from stable stored values. AI configuration has no stale primary, no paid fallback, and no mandatory network call at startup. The in-memory account repository exercises the already ruled data behaviors without committing to host-specific infrastructure. Run the project-required focused checks and report exact results; no push or deploy.

Accounts implementation still depends on the owner’s audience/location and the hosting/email facts above. Planner screens are blocked only on the design work, so they belong in this batch after the evidence-based revisions.

# STATE UPDATE

The workspace is read-only, so I did not edit the project records. These are copy-ready additions.

**`PROJECT_STATE.md`**

> Batch 6 verdict: hosting comparison partially accepted, with final host open; legal conclusions need correction and a complete source pass. Design research is incomplete: captures are marketing pages, no in-app evidence or revised directions. Both authorized AI requests received 429 before generation; no latency or schema-validity evidence. Codex authorizes one additional synthetic parse and one short-plan call on `google/gemma-4-31b-it:free` only after just-in-time zero-price verification; no retry/fallback/replacement. Plan-generation API is to be designed as a durable polled job, subject to host-specific worker/recovery design. Stable style values remain `notebook | blocks`, displayed provisionally as Fletore | Blloqe; color values remain `system | light | dark`. Batch 7 may implement design-dependent planner screens and host-independent settings, AI-model configuration, and in-memory accounts repository groundwork; no PostgreSQL adapter, account routes, deployment, push, or publishing.

**`CODEX_DECISIONS.md`**

> Batch 6: hosting/accounts/law research partially accepted; hosting choice remains open. Correct the legal summary: Article 7’s 16-year threshold concerns child consent for directly offered information-society services when consent is the lawful basis, not a universal service age; adequacy is not the only transfer route, and Article 49’s routes require Agency authorization. Owner questions on audience/age/location, real versus test data, and access to legal advice must be answered before launch scope is set. Design research is not accepted as complete until in-app evidence and revised paired styles exist. Live AI evidence is a refusal only; one additional synthetic parse and one plan request are authorized on the immediately revalidated zero-price `google/gemma-4-31b-it:free`, with no retry, fallback, or replacement. Approve a host-independent durable polled-job API design. Use Blloqe as the provisional display label for `blocks`. HIBP Pwned Passwords range API is the preferred compromised-password source, with local hashing, prefix-only request, disclosure, and no per-keystroke calls. Batch 7 scope and exclusions are in Codex’s Batch 6 verdict.

### Sources checked

The official Netlify, Vercel, Render, Neon, Kosovo Gazette, OpenRouter, and HIBP pages linked above support the specific current facts cited; provider limits and pricing must still be rechecked before deployment.