/**
 * Two real browser tabs writing to the same IndexedDB at the same moment, through the app's own
 * storage code. What the unit tests show against an in-memory store is shown here against the browser.
 *
 *   npm run client:build:e2e                             (a build that includes the harness page)
 *   PORT=3987 OPENROUTER_API_KEY= node server.js         (in another terminal)
 *   node e2e/app-two-tabs.mjs [baseUrl]
 *   npm run client:build                                 (afterwards: back to a build without the harness)
 *
 * Each round uses a database of its own. Both tabs are told to act in the same instant; which one the
 * browser serves first varies from round to round, and the result file records how often each won.
 * Result: e2e/results/app-two-tabs.json. Exit code 1 on any failure.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] ?? "http://127.0.0.1:3987").replace(/\/$/, "");
const ROUNDS = 20;
const RUN = Date.now().toString(36); // database names unique to this run

const profile = (name) => ({ id: "u-" + name, name, educationLevel: null, school: "", createdAt: "2026-10-01T08:00:00.000Z" });
const session = (id) => ({ id, status: "pending", date: "2026-10-15", startTime: "08:00", endTime: "09:00", type: "learning", title: "Seancë " + id, goal: "", tasks: [], material: null, difficulty: "medium" });
const plan = (id, subject, sessions = []) => ({
    id, createdAt: "2026-10-01T08:00:00.000Z", subject, startDate: "2026-10-14", endDate: "2026-10-30", planMode: "general", strategy: "", explanations: [], warnings: [],
    structured: {}, sessions: sessions.map(session),
});

const browser = await openBrowser({ debugPort: 9355 });
const { check } = browser;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

await browser.run(async () => {
    browser.result.base = BASE;
    const tabA = browser;
    const tabB = await browser.newTab();

    await Promise.all([tabA.goto(BASE + "/app/e2e-harness.html"), tabB.goto(BASE + "/app/e2e-harness.html")]);
    await Promise.all([tabA, tabB].map((tab) => tab.waitFor(`document.body.dataset.harness === "ready"`, "the harness page (was the client built with npm run client:build:e2e?)")));

    const call = (tab, db, method, ...args) => tab.evaluate(`window.harness.call(${JSON.stringify(db)}, ${JSON.stringify(method)}, ...${JSON.stringify(args)})`);
    /** The same, started a few milliseconds later inside the page, to vary which write reaches the database first. */
    const callAfter = (ms, tab, db, method, ...args) => tab.evaluate(`new Promise((r) => setTimeout(r, ${ms})).then(() => window.harness.call(${JSON.stringify(db)}, ${JSON.stringify(method)}, ...${JSON.stringify(args)}))`);
    const dump = (tab, db) => tab.evaluate(`window.harness.dump(${JSON.stringify(db)})`);
    /** Both tabs act in the same instant: the two commands are sent before either answer is awaited. */
    const together = (a, b) => Promise.all([a(), b()]);

    /* ---------- 1. First set-up from two tabs ---------- */
    {
        const wins = { A: 0, B: 0 };
        const problems = [];
        for (let i = 0; i < ROUNDS; i++) {
            const db = `race-init-${RUN}-${i}`;
            const [a, b] = await together(
                // Alternating which tab starts a few milliseconds late, so that each of them wins some rounds.
                () => callAfter(i % 2 === 0 ? 0 : 1 + (i % 5), tabA, db, "initialise", profile("Skeda A"), [plan("a1", "A1"), plan("a2", "A2")], { fromLegacy: false }),
                () => callAfter(i % 2 === 0 ? 1 + (i % 5) : 0, tabB, db, "initialise", profile("Skeda B"), [plan("b1", "B1")], { fromLegacy: false })
            );
            const stored = await dump(tabA, db);
            const keys = Object.keys(stored).sort();
            const winner = a.ok && !b.ok ? "A" : b.ok && !a.ok ? "B" : null;
            const loser = winner === "A" ? b : a;
            const expected = winner === "A" ? ["meta", "plan:a1", "plan:a2", "profile"] : ["meta", "plan:b1", "profile"];
            if (!winner) problems.push({ round: i, why: "not exactly one success", a, b });
            else if (loser.error !== "already_set_up") problems.push({ round: i, why: "loser was not refused as already set up", loser });
            else if (!same(keys, expected) || stored.profile?.name !== "Skeda " + winner) problems.push({ round: i, why: "storage is not the winner's data alone", keys, profile: stored.profile });
            else wins[winner]++;
            // The other tab must see exactly the same.
            if (!same(await dump(tabB, db), stored)) problems.push({ round: i, why: "the two tabs read different data" });
        }
        browser.result.initialise = { rounds: ROUNDS, wins };
        check(`first set-up, ${ROUNDS} rounds: every round exactly one tab wins, the other is refused, and storage holds the winner's data alone`, problems.length === 0, problems.slice(0, 3));
        console.log(`      tab A won ${wins.A}, tab B won ${wins.B}`);
    }

    /* ---------- 2. Two new plans under one id ---------- */
    {
        const wins = { A: 0, B: 0 };
        const problems = [];
        for (let i = 0; i < ROUNDS; i++) {
            const db = `race-create-${RUN}-${i}`;
            await call(tabA, db, "initialise", profile("Arta"), [], { fromLegacy: false });
            const [a, b] = await together(
                () => callAfter(i % 4, tabA, db, "createPlan", plan("same", "Nga A", ["a1"])),
                () => call(tabB, db, "createPlan", plan("same", "Nga B", ["b1", "b2"]))
            );
            const stored = (await dump(tabB, db))["plan:same"];
            const winner = a.ok && !b.ok ? "A" : b.ok && !a.ok ? "B" : null;
            const loser = winner === "A" ? b : a;
            const whole = winner === "A" ? stored?.subject === "Nga A" && same(stored.sessions.map((s) => s.id), ["a1"]) : stored?.subject === "Nga B" && same(stored?.sessions.map((s) => s.id), ["b1", "b2"]);
            if (!winner) problems.push({ round: i, why: "not exactly one success", a, b });
            else if (loser.error !== "plan_exists") problems.push({ round: i, why: "loser was not refused as existing", loser });
            else if (!whole) problems.push({ round: i, why: "the stored plan is not the winner's, whole", stored });
            else wins[winner]++;
        }
        browser.result.createPlan = { rounds: ROUNDS, wins };
        check(`new plan under a taken id, ${ROUNDS} rounds: one is stored whole, the other is refused, never a mixture or an overwrite`, problems.length === 0, problems.slice(0, 3));
        console.log(`      tab A won ${wins.A}, tab B won ${wins.B}`);
    }

    /* ---------- 3. Restore in one tab while the other saves ---------- */
    {
        const outcomes = { saveSurvived: 0, saveRemoved: 0 };
        const problems = [];
        const backup = { format: "planifikues-kopje", schemaVersion: 1, exportedAt: "2026-10-14T10:00:00.000Z", profile: profile("Nga kopja"), plans: [plan("r1", "R1"), plan("r2", "R2")] };
        for (let i = 0; i < ROUNDS; i++) {
            const db = `race-restore-${RUN}-${i}`;
            await call(tabA, db, "initialise", profile("Para"), [plan("old-1", "E vjetër 1"), plan("old-2", "E vjetër 2")], { fromLegacy: false });
            // The save is started 0 to 9 ms after the restore, so that across the rounds it lands on both sides of it.
            const [restore, save] = await together(() => call(tabA, db, "restoreBackup", backup), () => callAfter(i % 10, tabB, db, "savePlan", plan("meanwhile", "Ndërkohë")));
            const stored = await dump(tabB, db);
            const plans = Object.keys(stored).filter((k) => k.startsWith("plan:")).sort();
            // Two outcomes are right, depending on which write the browser ran first:
            // the save came first and the restore removed it with the rest, or it came after and stands beside the restored plans.
            const savedFirst = same(plans, ["plan:r1", "plan:r2"]);
            const savedAfter = same(plans, ["plan:meanwhile", "plan:r1", "plan:r2"]);
            if (!restore.ok || !save.ok) problems.push({ round: i, why: "an operation failed", restore, save });
            else if (!savedFirst && !savedAfter) problems.push({ round: i, why: "an old plan survived the restore, or a restored one is missing", plans });
            else if (stored.profile?.name !== "Nga kopja") problems.push({ round: i, why: "profile not restored", profile: stored.profile });
            else outcomes[savedAfter ? "saveSurvived" : "saveRemoved"]++;
        }
        browser.result.restore = { rounds: ROUNDS, outcomes };
        check(`restore against a simultaneous save, ${ROUNDS} rounds: no old plan ever survives and no restored plan is ever missing`, problems.length === 0, problems.slice(0, 3));
        console.log(`      the save landed after the restore ${outcomes.saveSurvived} times, before it ${outcomes.saveRemoved} times`);
    }

    /* ---------- 4. The app itself opened in two tabs on a device with the old page's data ---------- */
    {
        const user = JSON.stringify({ id: "legacy-1", name: "Arta", email: "a@example.test", password: "sekret-123", educationLevel: null, school: "", createdAt: "2026-09-01T08:00:00.000Z", plans: [plan("p1", "Matematikë", ["s1"]), plan("p2", "Kimi")] });
        await tabA.goto(BASE + "/");
        await tabA.evaluate(`localStorage.setItem("studyflow_users", ${JSON.stringify("[" + user + "]")}); localStorage.setItem("studyflow_current_user", ${JSON.stringify(user)});`);

        await Promise.all([tabA.goto(BASE + "/app"), tabB.goto(BASE + "/app")]);
        const state = (tab) => tab.evaluate(`({ state: document.querySelector('[data-testid="status"]')?.dataset.state, migration: document.querySelector('[data-testid="migration"]')?.dataset.status, plans: document.querySelector('[data-testid="plans"]')?.textContent })`);
        await Promise.all([tabA, tabB].map((tab) => tab.waitFor(`["ready", "failed"].includes(document.querySelector('[data-testid="status"]')?.dataset.state)`, "the app to finish starting")));
        const [a, b] = [await state(tabA), await state(tabB)];
        browser.result.appStart = { a, b };

        check("the app in two tabs on first start: both become ready, neither fails", a.state === "ready" && b.state === "ready", { a, b });
        check("one tab copies the old data and the other finds it done (or both find it done)", [a.migration, b.migration].filter((m) => m === "migrated").length <= 1 && [a.migration, b.migration].every((m) => m === "migrated" || m === "already_set_up"), { a, b });
        check("both tabs show the same two plans", a.plans === "Plane në këtë pajisje: 2" && b.plans === a.plans, { a: a.plans, b: b.plans });
        const db = await tabA.evaluate(`new Promise((resolve, reject) => { const open = indexedDB.open("planifikues"); open.onerror = () => reject(open.error); open.onsuccess = () => { const s = open.result.transaction("kv", "readonly").objectStore("kv"); const k = s.getAllKeys(), v = s.getAll(); v.onsuccess = () => { open.result.close(); resolve(Object.fromEntries(k.result.map((key, i) => [key, v.result[i]]))); }; }; })`);
        check("storage holds one profile and the two plans, without the password", same(Object.keys(db).sort(), ["meta", "plan:p1", "plan:p2", "profile"]) && !/sekret-123|a@example\.test/.test(JSON.stringify(db)), Object.keys(db));
    }

    check("no errors in either tab's console", browser.result.consoleErrors.length === 0, browser.result.consoleErrors.slice(0, 3));
}, (mkdirSync(path.join(HERE, "results"), { recursive: true }), path.join(HERE, "results", "app-two-tabs.json")));
