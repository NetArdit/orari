# StudyFlow

A study planner in Albanian. You describe what you have to learn, by when, and when you are free; the server works out your free time windows, an AI model places study sessions inside them, and you tick sessions off as you go. If you fall behind, the remaining plan can be rebuilt from today.

## Run it

Needs Node.js 22 or newer (the supported minimum; older versions are not tested).

```
npm install
copy .env.example .env      (then put your OpenRouter key in .env)
npm start
```

Open http://localhost:3000. `npm run dev` restarts the server when a file changes.

Without a key the app starts and the pages load, but anything that needs AI answers "AI nuk është konfiguruar ende."

## The new client (in progress)

A React client is being built in `client/` to replace the page in `public/`. Until it does, the old page stays at `/` and the new one is served at `/app` once it has been built:

```
npm run client:build     type-check, then build into client/dist
npm start                serves / (old page) and /app (new client)
npm run client:dev       development server with reload; needs npm start running for /api
```

On its first start the new client copies the profile and plans the old page stored in this browser into its own storage (IndexedDB). The password and e-mail address are not copied: there is no account, only a profile on this device. The old page's data is left as it is.

## Settings

| Variable | Needed | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | for AI features | Key from openrouter.ai. Only free models are used (the list is in `lib/ai.js`). |
| `OPENROUTER_MODELS` | no | Models to try, in order, comma-separated; every id must end in `:free` (there is no paid fallback). Checked for shape at start-up; the server stops with a message if it is wrong. Defaults are in `lib/ai.js`. |
| `PORT` | no | Port to listen on. Default 3000. |

## Where your data is

Accounts, plans and progress are stored only in the browser you use (localStorage). Nothing is saved on the server. Clearing the browser's site data, or using another browser or device, means the data is not there. The text you write to create a plan is sent to the AI provider (OpenRouter and the model behind it).

## Checks

```
npm test                   server tests (Node's built-in runner)
npm run check              syntax check of the application files (server, lib, public script), not of the tests
npm run client:typecheck   TypeScript check of the client
npm run client:test        client tests (Vitest)
npm run test:all           the three above that test
```

Browser journeys, in headless Edge or Chrome, against a running server (`PORT=3987 node server.js`). They replace the AI routes inside the page with canned answers, so no AI is called:

```
node e2e/legacy-create.mjs      old page: creating a plan by form and by free text
node e2e/app-foundation.mjs     new client: storage, copy of old data, addresses (needs client:build)
```

The tests never call the AI provider: routes are tested against a stand-in passed to `createApp`. Tests named `KNOWN DEFECT` describe behaviour that is wrong today and is scheduled to be fixed; when a fix lands, that test's expectation is reversed in the same change.

Live AI behaviour (real models, their limits, long plans) is not covered by any automated check and needs a key to try by hand.

## Layout

```
server.js        reads .env, starts the server
lib/app.js       the Express app and its routes (createApp)
lib/time.js      dates, weekdays and free-window arithmetic
lib/plan.js      calendar limits, checking AI sessions against free windows, statistics
lib/schema.js    shapes of requests and of AI answers (zod)
lib/ai.js        prompts, model fallback, safe JSON extraction
public/          the current web page (HTML, CSS, JavaScript), served at /
client/          the new client (React, TypeScript, Tailwind), served at /app after a build
e2e/             browser journeys
test/            server tests
docs/design/     the two visual directions offered for the new client
docs/agent-handoff/   working records of the audit and the improvement work
```

## API

| Route | Body | Answer |
|---|---|---|
| `GET /api/health` | | `{ success, message, aiConfigured }` |
| `POST /api/parse` | `{ text }` | `{ parsed }`: dates, subject, availability, commitments, questions |
| `POST /api/create-plan` | `{ profile, structured }` | the plan: sessions, statistics, strategy, warnings |
| `POST /api/adjust-plan` | `{ profile, structured, progress }` | a new plan from `progress.today` to the end date |

Errors are `{ error }` with a message in Albanian that is safe to show.

## Deploying (Render + Neon)

The server is a long-running Node process (plan jobs, rate limits and sessions' dispatch run in it), so it needs a host that keeps a process alive: Render, Railway or Fly. Netlify and Vercel run short serverless functions and do not fit without a rewrite.

1. **Database.** Create a project at neon.tech (or Supabase) and copy the connection string (`postgres://...?sslmode=require`). The server creates its tables itself at start (`lib/accounts/postgres/schemaSql.js`, all `IF NOT EXISTS`).
2. **Mail.** Any SMTP provider (Brevo, Mailgun, Postmark, Gmail with an app password). `SMTP_URL=smtps://user:password@host:465`, `MAIL_FROM=Orari <address@your-domain>`. The sender must be allowed by the provider, or messages are refused; refused messages stay in the database outbox and are retried five times.
3. **Service.** Push the repository to GitHub, create a Blueprint on render.com from `render.yaml`, and fill in the secrets: `DATABASE_URL`, `ORARI_BASE_URL` (the service's `https://` address), `SMTP_URL`, `MAIL_FROM`, `GROQ_API_KEY`. `TRUST_PROXY=1` is already set.
4. **Check.** `https://<service>/api/health` answers; `https://<service>/app/` opens the new client; sign up, open the e-mailed link, sign in, save a plan.

Run the same stack locally with real PostgreSQL: `node e2e/postgres-smoke.mjs` (embedded PostgreSQL and a local SMTP sink, no accounts anywhere).

Not covered by any test: a real SMTP provider's delivery and spam handling, Neon/Supabase specifics (connection limits, cold starts of the database), and the real reverse proxy of the host.

## Deploying on Netlify (no process that stays up)

`netlify.toml` publishes the pages from `netlify-dist/`, runs the whole API as one function (`netlify/functions/api.js`), runs the AI work of a plan as a background function (`job-background.js`, up to 15 minutes, answered 202 at once) and retries unsent mail hourly (`housekeeping.js`). Jobs live in the PostgreSQL table `jobs` (`lib/jobsDb.js`), so a poll finds the answer whichever instance serves it. Environment variables are the same as for Render, plus `ORARI_BASE_URL` set to the site's own address. The site must have visitor protection off, or the function cannot call itself.
Limits that matter at no cost: per-client AI rate limits are counted per warm function instance (weaker than on one server); a cancelled job is marked cancelled but the running AI call is not interrupted; the free Netlify plan counts credits per production deploy.

## Reminders, rescheduling and the weekly review

- **Reminders by push** (Netlify only): the browser tells the server when to remind (`/api/push/sync`), a scheduled function (`housekeeping.js`, every 30 minutes between 05:00 and 22:59 UTC) sends what is due with Web Push (`lib/pushDb.js`). Needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Retries after 1, 5 and 30 minutes (3 attempts), dead subscriptions (404/410) are deleted, quiet hours and the daily cap are enforced on the server. The list of due and missed sessions on the Today screen works with push off.
- **Why every 30 minutes, not every minute:** each run wakes the free Neon database, which counts the hours it is awake (191 a month); a 5-minute cadence would use them all. A reminder is therefore usually delivered within about 30 minutes of its time.
- **Drafts and publishing**, the validator (`client/src/domain/validate.ts`), placement and rescheduling (`schedule.ts`) and the weekly review (`review.ts`) run in the browser; plans stay on the device.
- Real-device checks (iOS Home Screen app, Android Chrome, desktop permission states, snooze buttons on a lock screen) cannot be done by tests and are listed in ORARI_PROGRESS.md.
