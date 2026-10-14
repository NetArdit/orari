# Batch 6, deliverable 1: hosting, accounts and the law

Collected 2026-10-14 (UTC) by Claude Code from the pages named under each heading. Every figure is quoted or closely paraphrased from the page; where a page did not say, the entry reads **not stated** and nothing was filled in. Prices and limits change: recheck before any deployment decision.

Evidence labels: **OBSERVED** (read on the page), **NOT STATED** (page silent), **FAILED** (page could not be read), **INFERRED** (my reading, marked as such).

## 1. The constraint that matters

The AI routes hold a request open for up to 75 s (`DEFAULT_DEADLINE_MS` in `lib/ai.js`), and the client waits 85 s. Whatever hosts the Express app must either allow requests that long or the work must become a job the client polls.

## 2. Hosting options

| | Request time | Idle behaviour | Durable disk | Notes |
|---|---|---|---|---|
| **Netlify Functions** (docs.netlify.com/build/functions/configuration) | OBSERVED: synchronous **60 s**, not configurable; background functions **15 min**; background payload **256 KB**; buffered payload 6 MB | n/a (serverless) | none | OBSERVED: the page does not state Free-plan specifics; memory and region settings are Pro and Enterprise only. NOT STATED: whether streaming escapes the 60 s limit. |
| **Vercel Hobby** (vercel.com/docs/functions/limitations, /limits/fair-use-guidelines; last updated 2026-08-24 and 2026-09-14) | OBSERVED: Hobby **300 s** default and maximum with fluid compute; 2 GB / 1 vCPU; request and response body 4.5 MB | n/a (serverless) | none | OBSERVED: Hobby is "restricted to non-commercial personal use only"; commercial means any deployment used for the financial gain of anyone involved in production, including a paid consultant writing the code; donations are not commercial. Included on Hobby: 1,000,000 invocations, 4 h active CPU, 100 GB transfer. NOT STATED on these pages: whether an Express app deploys unchanged. |
| **Render free web service** (render.com/docs/free) | NOT STATED | OBSERVED: spins down after **15 min** without inbound traffic; spin-up "about one minute"; **750** free instance hours per month | OBSERVED: filesystem is ephemeral; persistent disks unsupported | OBSERVED: free services **cannot send outbound traffic on ports 25, 465 or 587**, so SMTP is impossible; e-mail must go through an HTTPS API. OBSERVED: free Postgres is 1 GB and **expires 30 days after creation**, with a 14-day grace period. OBSERVED: custom domains and managed TLS are supported. RAM and CPU NOT STATED. |
| **Koyeb free instance** (koyeb.com/docs/reference/instances) | NOT STATED | OBSERVED: scales to zero after **1 hour** without traffic; wake-up delay NOT STATED | OBSERVED: 2 GB SSD, volumes cannot be attached | OBSERVED: 512 MB RAM, 0.1 vCPU, one free instance per organisation, Frankfurt or Washington D.C., web services only; "for testing and hobby projects, not production". The pricing page (koyeb.com/pricing) did not list a free compute instance, so the two Koyeb pages disagree or the pricing page is partial: treat as unverified until the owner confirms in the dashboard. |

INFERRED, not verified by any call: a long-running free container (Render, Koyeb) fits a 75 s request but sleeps and cold-starts, so the first request after idle would take about a minute before the AI even starts; Vercel Hobby fits 75 s on paper but forbids commercial use and is serverless, which suits a polled-job design better than a held connection.

## 3. Database

**Neon Free** (neon.com/pricing), OBSERVED: 1 GB per project (20 GB across projects), 100 CU-hours per project, up to 100 projects, 10 branches; compute autosuspends after **5 minutes** and "cannot be turned off", cold-start time NOT STATED; point-in-time restore window **6 hours** (capped at 1 GB), instant restore not included; **no credit card, no expiry** ("The Free plan is permanent (not a trial)"). Connection limits and regions NOT STATED on that page.

Consequence (INFERRED): a database that suspends after 5 minutes means the first request after a quiet spell pays a cold start on top of any host cold start; a 6-hour history window is not a backup strategy, so the account-data export and a scheduled dump to somewhere the owner controls are requirements, not extras.

**Render Postgres** is excluded for production by its 30-day expiry.

## 4. E-mail for password reset

**Brevo**: FAILED. The pricing page returned no plan details and the help-centre article returned 403. Nothing is claimed about Brevo's free limits, branding or sender requirements. Next step: the owner, who has a Brevo account from another project, reads the limits in their dashboard, or a different source is found. Independently: Render blocks SMTP, so any provider must be used through its HTTPS API.

## 5. Kosovo Law No. 06/L-082 on Protection of Personal Data

Source: Official Gazette (gzk.rks-gov.net, ActID 18616), Albanian text. The page text is 162,873 characters; **the reading covered the first 100,000** and the text is truncated in Chapter XI, so the penalty provisions were **not read**. Article numbers below are from that text; this is engineering research, not legal advice and not a compliance claim.

- **Scope (Art. 2)**: public and private bodies; excludes purely personal purposes; also covers controllers not established in Kosovo that use equipment there.
- **Lawful bases (Art. 5)**: consent; contract; legal obligation; vital interests; public interest; legitimate interests, with children's interests weighing against them. **Consent (Art. 6)**: the controller must be able to prove it; it can be withdrawn at any time.
- **Children (Art. 7)**: for information society services, processing is lawful from **16 years**; below 16 it needs consent or authorisation of the holder of parental responsibility; for 14 to 16 the controller must make continuous efforts to verify parental consent.
- **Rights (Arts. 14 to 21)**: access (14), correction (15), erasure (16), restriction (17), portability (19), objection (20), protection against solely automated decisions (21).
- **Breach (Art. 33)**: notify the Agency **within 72 hours** of becoming aware, unless unlikely to risk individuals; Art. 34 covers telling affected people.
- **Transfers (Arts. 44 to 47)**: allowed only to a country or organisation with an adequate level of protection, which needs a formal decision of the Agency and a place on its list (45, 46); the safeguards-based routes were in the unread part.
- **Authority**: Agjencia për Informim dhe Privatësi (Art. 3).
- **Penalties**: not read.

### What this means for Orari (INFERRED; to be confirmed by someone qualified)

1. **Likely users are students, many under 16.** Art. 7 would require parental consent or authorisation for them. Whether Orari's target audience includes under-16s is a product decision the owner has not given; it changes sign-up design (age gate, parental consent) and may change the launch audience.
2. **Study material is sent to a third-party AI provider outside Kosovo** (OpenRouter and the model behind it). Art. 44 makes such transfers conditional on adequacy. Whether and how that is satisfied, or whether consent is a sufficient route, was in the unread part or needs a lawyer. Until resolved, the app must not send account-linked personal data to the AI; the text the person types is the exposure, and the notice must say so.
3. **Rights are product features**: export (portability), deletion (erasure), correction. All three are already on the account work list.
4. **A 72-hour breach duty** means an incident procedure and logs that can say what was affected.

### Questions for the owner
- Who is Orari for: which ages, which country or countries, and is it public or a portfolio piece?
- Will it process real students' data, or demonstrate with test accounts?
- Is a lawyer or the Agency's guidance available if it goes public?

## 6. Summary of what is established and what is not

Established by documentation: Netlify cannot hold a 75 s synchronous request; Render free sleeps, has no durable disk, blocks SMTP and expires its database; Neon Free is permanent but suspends after 5 minutes; Vercel Hobby allows 300 s but not commercial use; Kosovo's law sets 16 as the age of digital consent and conditions transfers abroad.

Not established: Brevo's limits; Koyeb's free tier (two pages disagree); cold-start times for Neon and Koyeb; that an Express app deploys unchanged to Vercel; Netlify Free-plan specifics; the law's penalties and safeguards routes; real model latency (see the live AI deliverable).
