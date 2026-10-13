# StudyFlow

A study planner in Albanian. You describe what you have to learn, by when, and when you are free; the server works out your free time windows, an AI model places study sessions inside them, and you tick sessions off as you go. If you fall behind, the remaining plan can be rebuilt from today.

## Run it

Needs Node.js 22 or newer.

```
npm install
copy .env.example .env      (then put your OpenRouter key in .env)
npm start
```

Open http://localhost:3000. `npm run dev` restarts the server when a file changes.

Without a key the app starts and the pages load, but anything that needs AI answers "AI nuk është konfiguruar ende."

## Settings

| Variable | Needed | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | for AI features | Key from openrouter.ai. Only free models are used (the list is in `lib/ai.js`). |
| `PORT` | no | Port to listen on. Default 3000. |

## Where your data is

Accounts, plans and progress are stored only in the browser you use (localStorage). Nothing is saved on the server. Clearing the browser's site data, or using another browser or device, means the data is not there. The text you write to create a plan is sent to the AI provider (OpenRouter and the model behind it).

## Checks

```
npm test         all tests (Node's built-in runner, no extra packages)
npm run check    syntax check of every source file
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
public/          the web page (HTML, CSS, JavaScript)
test/            tests
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
