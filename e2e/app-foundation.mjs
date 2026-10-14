/**
 * Journey on the new client's foundation at /app: storage in a real IndexedDB, the one-time copy of
 * the old page's data, addresses, and living beside the old page.
 *
 *   npm run client:build
 *   PORT=3987 OPENROUTER_API_KEY= node server.js        (in another terminal)
 *   node e2e/app-foundation.mjs [baseUrl]
 *
 * No AI route is called. Result: e2e/results/app-foundation.json. Exit code 1 on any failure.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser, isoDay, sleep } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] ?? "http://127.0.0.1:3987").replace(/\/$/, "");

const session = (id, dayOffset, status, title) => ({
    id, status, date: isoDay(dayOffset), startTime: "08:00", endTime: "09:00", type: "learning", title, goal: "Qëllimi", tasks: ["Një", "Dy"], material: "Kapitulli 3", difficulty: "hard",
});

const structured = { startDate: isoDay(-3), endDate: isoDay(10), subject: "Matematikë", planMode: "exam", weeklyAvailability: [], commitments: [], unavailableDates: [], difficulty: "medium" };

// The shape public/script.js stores, including what must not come along (password, e-mail)
// and the damage the old server could leave behind (the same session id twice in one plan).
const LEGACY_USER = {
    id: "legacy-user-1", name: "Arta Krasniqi", email: "arta@example.test", password: "sekret-123", educationLevel: "university", school: "FSHMN",
    createdAt: "2026-09-01T08:00:00.000Z",
    plans: [
        {
            id: "plan-1", createdAt: "2026-10-01T08:00:00.000Z", structured, profile: { name: "Arta Krasniqi" }, subject: "Matematikë",
            startDate: structured.startDate, endDate: structured.endDate, planMode: "exam", strategy: "Strategjia", explanations: ["Sepse"], warnings: ["Kujdes"],
            stats: { totalSessions: 4, totalMinutes: 240, totalHours: 4 },
            sessions: [session("s1", -3, "completed", "E kryer"), session("a1", -1, "skipped", "E anashkaluar"), session("a1", 0, "partial", "Përgjysmë, me id të dyfishtë"), session("a2", 2, "pending", "Në pritje")],
        },
        {
            id: "plan-2", createdAt: "2026-10-05T08:00:00.000Z", structured: { ...structured, subject: "Kimi" }, subject: "Kimi",
            startDate: structured.startDate, endDate: structured.endDate, planMode: "general", strategy: "", explanations: [], warnings: [],
            stats: { totalSessions: 1, totalMinutes: 60, totalHours: 1 }, sessions: [session("k1", 1, "pending", "Kimi 1")],
        },
    ],
};

const browser = await openBrowser({ debugPort: 9354 });
const { evaluate, goto, waitFor, check, cdp } = browser;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ready = () => waitFor(`document.querySelector('[data-testid="status"]')?.dataset.state === "ready"`, "the foundation to finish starting");
const text = (testId) => evaluate(`document.querySelector('[data-testid="${testId}"]')?.textContent ?? null`);

/** Everything in the app's IndexedDB as { key: value }, read with the browser's own API, not through the app. */
const readDatabase = () => evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open("planifikues");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("kv")) { db.close(); return resolve({}); }
        const store = db.transaction("kv", "readonly").objectStore("kv");
        const keys = store.getAllKeys(); const values = store.getAll();
        values.onsuccess = () => { db.close(); resolve(Object.fromEntries(keys.result.map((k, i) => [k, values.result[i]]))); };
        values.onerror = () => reject(values.error);
    };
})`);

await browser.run(async () => {
    browser.result.base = BASE;

    /* ---------- 1. A device that has never been used ---------- */
    await goto(BASE + "/app");
    await ready();
    check("fresh device: nothing to copy, no profile, no plans", (await evaluate(`document.querySelector('[data-testid="migration"]').dataset.status`)) === "nothing_to_migrate" && (await text("profile")) === "Profili: ende pa profil" && (await text("plans")) === "Plane në këtë pajisje: 0");
    check("fresh device: nothing is written to storage", same(await readDatabase(), {}), await readDatabase());
    check("the server answers and says it has no AI key", (await text("server")).includes("gati, pa çelës AI"), await text("server"));

    /* ---------- 2. A device with the old page's data ---------- */
    const user = JSON.stringify(LEGACY_USER);
    await evaluate(`localStorage.setItem("studyflow_users", ${JSON.stringify("[" + user + "]")}); localStorage.setItem("studyflow_current_user", ${JSON.stringify(user)});`);
    const legacyBefore = await evaluate(`[localStorage.getItem("studyflow_users"), localStorage.getItem("studyflow_current_user")]`);

    await goto(BASE + "/app");
    await ready();
    check("old data: copied on the first start", (await evaluate(`document.querySelector('[data-testid="migration"]').dataset.status`)) === "migrated", await text("migration"));
    check("old data: the profile and both plans are there", (await text("profile")) === "Profili: Arta Krasniqi" && (await text("plans")) === "Plane në këtë pajisje: 2", [await text("profile"), await text("plans")]);

    const db = await readDatabase();
    check("storage holds meta, the profile and one entry per plan", same(Object.keys(db).sort(), ["meta", "plan:plan-1", "plan:plan-2", "profile"]), Object.keys(db));
    check("storage: the profile has no password and no e-mail", same(db.profile, { id: "legacy-user-1", name: "Arta Krasniqi", educationLevel: "university", school: "FSHMN", createdAt: "2026-09-01T08:00:00.000Z" }), db.profile);
    check("storage: the secret and the e-mail appear nowhere", !/sekret-123|password|arta@example\.test/.test(JSON.stringify(db)));
    check("storage: meta records the version and that the data came from the old page", db.meta?.schemaVersion === 1 && typeof db.meta?.migratedFromLegacyAt === "string", db.meta);

    const plan1 = db["plan:plan-1"] ?? {};
    const sessions = plan1.sessions ?? [];
    check("plan: subject, dates, strategy, warnings and inputs are carried over", plan1.subject === "Matematikë" && plan1.startDate === structured.startDate && plan1.endDate === structured.endDate && plan1.strategy === "Strategjia" && same(plan1.warnings, ["Kujdes"]) && same(plan1.structured, structured), plan1);
    check("plan: every session keeps its status, in order", same(sessions.map((s) => [s.title, s.status]), [["E kryer", "completed"], ["E anashkaluar", "skipped"], ["Përgjysmë, me id të dyfishtë", "partial"], ["Në pritje", "pending"]]), sessions.map((s) => [s.title, s.status]));
    check("plan: session times, tasks and material are unchanged", same(sessions.map(({ id, status, ...rest }) => rest), LEGACY_USER.plans[0].sessions.map(({ id, status, ...rest }) => rest)));
    check("plan: the duplicate session id is repaired, the first keeps its id", sessions[0]?.id === "s1" && sessions[1]?.id === "a1" && sessions[2]?.id !== "a1" && sessions[3]?.id === "a2" && new Set(sessions.map((s) => s.id)).size === 4, sessions.map((s) => s.id));

    const legacyAfter = await evaluate(`[localStorage.getItem("studyflow_users"), localStorage.getItem("studyflow_current_user")]`);
    check("the old page's keys are untouched, byte for byte", same(legacyBefore, legacyAfter));

    /* ---------- 3. Starting again ---------- */
    await goto(BASE + "/app");
    await ready();
    check("second start: nothing is copied again and the data is still there", (await evaluate(`document.querySelector('[data-testid="migration"]').dataset.status`)) === "already_set_up" && (await text("plans")) === "Plane në këtë pajisje: 2");
    check("second start: storage is identical", same(await readDatabase(), db));

    /* ---------- 4. Addresses ---------- */
    await evaluate(`window.__samePage = true`);
    await evaluate(`[...document.querySelectorAll("nav a")].find((a) => a.textContent === "Orari").click()`);
    await sleep(150);
    check("a link changes the address and the screen without reloading the page", (await evaluate(`[location.pathname, document.querySelector('[data-testid="screen"]').textContent, window.__samePage === true, document.title]`)).join("|") === "/app/orari|Orari|true|Orari · Planifikuesi", await evaluate(`[location.pathname, document.querySelector('[data-testid="screen"]').textContent, window.__samePage, document.title]`));
    check("the current screen is marked for assistive technology", (await evaluate(`[...document.querySelectorAll('nav a[aria-current="page"]')].map((a) => a.textContent).join()`)) === "Orari");
    await evaluate(`history.back()`);
    await sleep(150);
    check("Back returns to the previous screen", (await evaluate(`[location.pathname, document.querySelector('[data-testid="screen"]').textContent]`)).join("|") === "/app/|Sot", await evaluate(`location.pathname`)); // the server sends /app on to /app/

    await goto(BASE + "/app/planet/plan-1/seanca/s1");
    await ready();
    check("a deep address opens its screen directly", (await evaluate(`document.querySelector('[data-testid="screen"]').textContent`)) === "Një seancë");
    await goto(BASE + "/app/nuk-ekziston");
    await ready();
    check("an unknown address says so and offers a way back", (await evaluate(`document.querySelector('[data-testid="screen"]').textContent`)) === "Kjo faqe nuk ekziston" && (await evaluate(`Boolean([...document.querySelectorAll("main a")].find((a) => a.textContent === "Kthehu te Sot"))`)));

    /* ---------- 5. Keyboard and phone width ---------- */
    await goto(BASE + "/app");
    await ready();
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    const focused = await evaluate(`(() => { const el = document.activeElement; const s = getComputedStyle(el); return { text: el.textContent, outline: s.outlineStyle, height: Math.round(el.getBoundingClientRect().height) }; })()`);
    check("Tab reaches the first navigation link, with a visible focus outline and a 44 px target", focused.text === "Sot" && focused.outline !== "none" && focused.height >= 44, focused);

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
    await goto(BASE + "/app");
    await ready();
    const widths = await evaluate(`({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth })`);
    check("at 360 px the page is 360 px wide: nothing is cut off or shrunk", widths.inner === 360 && widths.scroll === 360, widths);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    /* ---------- 6. The old page still works beside it ---------- */
    await goto(BASE + "/");
    check("the old page is still at / and opens with the same user", (await evaluate(`document.title`)) === "StudyFlow" && (await evaluate(`!document.getElementById("app").classList.contains("hidden") && document.getElementById("userName").textContent`)) === "Arta Krasniqi");
    check("the old page still counts its two plans", (await evaluate(`document.getElementById("totalPlans").textContent`)) === "2");

    check("no errors in the browser console (which would include anything the security policy blocked)", browser.result.consoleErrors.length === 0, browser.result.consoleErrors);
}, (mkdirSync(path.join(HERE, "results"), { recursive: true }), path.join(HERE, "results", "app-foundation.json")));
