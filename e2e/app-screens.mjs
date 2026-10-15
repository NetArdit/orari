/**
 * The planner screens of the new client in a real browser: what each shows, that the look settings
 * work and persist, that marking survives a reload, and a screenshot of every screen in all four
 * combinations of style and colour mode at phone and desktop widths.
 *
 *   npm run client:build
 *   PORT=3987 OPENROUTER_API_KEY= node server.js        (in another terminal)
 *   node e2e/app-screens.mjs [baseUrl]
 *
 * Screenshots go to e2e/results/screens/ (git-ignored). No AI route is called.
 * Result: e2e/results/app-screens.json. Exit code 1 on any failure.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isoDay, openBrowser, sleep } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] ?? "http://127.0.0.1:3987").replace(/\/$/, "");
const SHOTS = path.join(HERE, "results", "screens");
mkdirSync(SHOTS, { recursive: true });

const session = (id, dayOffset, startTime, endTime, status, type, title, tasks = []) => ({
    id, status, date: isoDay(dayOffset), startTime, endTime, type, title, goal: "Të kuptosh rregullat bazë para ushtrimeve.", tasks, material: "Kapitulli 4", difficulty: "medium",
});

const user = {
    id: "legacy-1", name: "Arta", email: "arta@example.test", password: "sekret-123", educationLevel: "university", school: "FSHMN",
    createdAt: "2026-09-01T08:00:00.000Z",
    plans: [{
        id: "plan-1", createdAt: "2026-10-01T08:00:00.000Z", subject: "Matematikë", startDate: isoDay(-3), endDate: isoDay(14), planMode: "exam",
        strategy: "Fillojmë me konceptet, pastaj ushtrime, dhe në fund përsëritje para provimit.", explanations: ["Mësimi i ri vjen para ushtrimeve.", "Çdo të tretën ditë ka rikujtim."], warnings: ["Koha është e ngushtë për tre kapituj."],
        structured: { startDate: isoDay(-3), endDate: isoDay(14), subject: "Matematikë" },
        sessions: [
            session("s1", -3, "08:00", "09:00", "completed", "learning", "Funksionet: përkufizimi"),
            session("s2", -2, "08:00", "09:00", "completed", "practice", "Funksionet: ushtrime"),
            session("s3", -1, "20:00", "21:00", "pending", "recall", "Rikujtim i formulave"),
            session("s4", 0, "00:05", "00:35", "completed", "recall", "Formulat e trigonometrisë"),
            session("s5", 0, "23:00", "23:45", "pending", "learning", "Derivatet: rregullat bazë me një titull të gjatë që duhet të thyhet pa prishur faqen", ["Lexo faqet 84–91", "Zgjidh ushtrimet 1–6"]),
            session("s6", 1, "17:30", "18:30", "pending", "practice", "Detyra nga libri, faqe 92"),
            session("s7", 3, "18:00", "19:30", "pending", "assessment", "Test provues: kapitujt 3 dhe 4"),
        ],
    }],
};

const browser = await openBrowser({ debugPort: 9356, width: 390, height: 844, mobile: true });
const { evaluate, goto, waitFor, check, cdp } = browser;
const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null`);
const ready = () => waitFor(`Boolean(document.querySelector("main h1, main h2"))`, "a screen");
const viewport = (width, height, mobile) => cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
// Through the settings screen, as a person would: that writes both the device's record and its first-paint cache.
const setLook = async (style, theme) => {
    await goto(BASE + "/app/settings");
    await ready();
    const isDark = await evaluate(`document.documentElement.dataset.theme === "dark"`);
    if (isDark !== (theme === "dark")) await evaluate(`document.querySelector('[data-testid=theme-toggle]').click()`);
    await sleep(250);
};

await browser.run(async () => {
    browser.result.base = BASE;

    // A device with the old page's data: the app copies it on first start.
    await goto(BASE + "/");
    await evaluate(`localStorage.clear(); const u = ${JSON.stringify(JSON.stringify(user))}; localStorage.setItem("studyflow_users", "[" + u + "]"); localStorage.setItem("studyflow_current_user", u);`);
    await goto(BASE + "/app/");
    await ready();

    /* ---------- Today ---------- */
    check("Today: the page title and heading", (await evaluate("document.title")) === "Today · Orari" && (await text("h1")) === "Today", [await evaluate("document.title"), await text("h1")]);
    check("Today: the next session is shown and is the later one today", (await text('section[aria-label="Next session"] h2'))?.startsWith("Derivatet: rregullat bazë"), await text('section[aria-label="Next session"] h2'));
    check("Today: the agenda lists today's two sessions in time order", JSON.stringify(await evaluate(`[...document.querySelectorAll('section[aria-label="Today"] li')].map(li => li.querySelector("a")?.textContent.slice(0, 20))`)) === JSON.stringify(["Formulat e trigonome", "Derivatet: rregullat"]), await evaluate(`[...document.querySelectorAll('section[aria-label="Today"] li')].map(li => li.querySelector("a")?.textContent.slice(0, 20))`));
    check("Today: a missed session from yesterday offers to adjust the plan", (await text("section, div[class*=bg-warn-wash]")) !== null && (await evaluate(`[...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Rearrange the plan")`)));
    check("Today: the three marks are buttons with a pressed state", (await evaluate(`document.querySelectorAll('section[aria-label="Today"] [role=group] button[aria-pressed]').length`)) === 6);

    /* ---------- marking ---------- */
    // A script's click() does not move focus, so focus the button first, as a keyboard user would have.
    await evaluate(`(() => { const b = [...document.querySelectorAll('section[aria-label="Today"] li')][1].querySelector('button[aria-pressed]'); b.focus(); b.click(); })()`);
    await sleep(300);
    check("marking: focus stays on the button that was pressed (a re-render must not move it)", (await evaluate(`document.activeElement?.tagName === "BUTTON" && document.activeElement.getAttribute("aria-pressed") === "true"`)), await evaluate(`document.activeElement?.tagName + " " + document.activeElement?.textContent`));
    check("marking: the session shows as done at once", (await evaluate(`[...document.querySelectorAll('section[aria-label="Today"] li')][1].querySelector('button[aria-pressed="true"]')?.textContent`)) === "Done");
    await goto(BASE + "/app/");
    await ready();
    await sleep(300);
    check("marking: it is still done after reloading the page", (await evaluate(`[...document.querySelectorAll('section[aria-label="Today"] li')][1]?.querySelector('button[aria-pressed="true"]')?.textContent`)) === "Done");
    await evaluate(`[...document.querySelectorAll('section[aria-label="Today"] li')][1].querySelector('button[aria-pressed="true"]').click()`);
    await sleep(300);
    check("marking: pressing the chosen mark again clears it", (await evaluate(`[...document.querySelectorAll('section[aria-label="Today"] li')][1].querySelectorAll('button[aria-pressed="true"]').length`)) === 0);

    /* ---------- the other screens ---------- */
    await goto(BASE + "/app/week");
    await ready();
    check("Week: seven days, today marked, sessions placed on their days", (await evaluate(`document.querySelectorAll("main section[aria-label] > h2").length`)) === 7 && (await evaluate(`document.querySelectorAll("main section[aria-label] li").length`)) >= 5);
    await goto(BASE + "/app/plans");
    await ready();
    check("Plans: the plan is listed with its progress", ((await text("main ul li a")) ?? "").includes("Matematikë"), await text("main ul li a"));
    await goto(BASE + "/app/plans/plan-1");
    await ready();
    check("Plan: strategy, a warning and sessions grouped by day", (await text("main")).includes("Fillojmë me konceptet") && (await text("main")).includes("Koha është e ngushtë") && (await evaluate(`document.querySelectorAll("main section[aria-label] li").length`)) === 7);
    await goto(BASE + "/app/plans/plan-1/sessions/s5");
    await ready();
    check("Session: title, goal, the tasks and the marks", (await text("h1")).startsWith("Derivatet") && (await text("main")).includes("Lexo faqet 84–91") && (await evaluate(`document.querySelectorAll('main [role=group] button').length`)) === 3);

    await goto(BASE + "/app/new-plan");
    await ready();
    check("New plan: the description step, with the notice about the external AI service", (await text("h1")) === "What do you want to learn?" && (await text("main")).includes("outside AI service"));
    await evaluate(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("fill it in myself")).click()`);
    await sleep(200);
    check("New plan: the form is there, with days, busy time and days without study", (await evaluate(`["When you are free", "When you are busy", "Days without study"].every(t => [...document.querySelectorAll("legend")].some(l => l.textContent === t))`)));
    await evaluate(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Create the schedule").click()`);
    await sleep(300);
    check("New plan: an empty form is refused at once with the fields named, and nothing is sent", (await text('[role=alert]'))?.startsWith("Some fields") && (await text("main")).includes("Fill in this field."), await text('[role=alert]'));

    /* ---------- settings and the look ---------- */
    await goto(BASE + "/app/settings");
    await ready();
    check("Settings: one appearance switch (light mode / dark mode), no sync buttons, no list of devices", (await evaluate(`document.querySelectorAll('[data-testid=theme-toggle]').length`)) === 1 && !(await text("main")).includes("Get plans from the account") && !(await text("main")).includes("signed in"));
    check("Settings: the default is light mode (notebook layout)", (await evaluate(`[document.documentElement.dataset.style, document.documentElement.dataset.theme].join()`)) === "notebook,light");
    await evaluate(`document.querySelector('[data-testid=theme-toggle]').click()`);
    await sleep(300);
    check("Settings: dark mode changes the page at once (blocks layout, dark colours)", (await evaluate(`[document.documentElement.dataset.style, document.documentElement.dataset.theme].join()`)) === "blocks,dark");
    await goto(BASE + "/app/settings");
    check("Settings: the choice is in place before the app has loaded, with no flash (the attributes are set by the first script)", (await evaluate(`[document.documentElement.dataset.style, document.documentElement.dataset.theme].join()`)) === "blocks,dark");
    await ready();

    /* ---------- the four looks, phone and desktop ---------- */
    const screens = [["sot", "/app/"], ["orari", "/app/week"], ["plan-i-ri", "/app/new-plan"], ["plani", "/app/plans/plan-1"], ["seanca", "/app/plans/plan-1/sessions/s5"], ["cilesimet", "/app/settings"]];
    const overflow = [];
    for (const [sizeName, width, height, mobile] of [["telefon", 390, 844, true], ["kompjuter", 1280, 900, false]]) {
        await viewport(width, height, mobile);
        for (const [style, theme] of [["notebook", "light"], ["blocks", "dark"]]) {
            {
                await setLook(style, theme);
                for (const [name, url] of screens) {
                    await goto(BASE + url);
                    await ready();
                    await sleep(250);
                    const m = await evaluate(`({ w: window.innerWidth, s: document.documentElement.scrollWidth, style: document.documentElement.dataset.style, theme: document.documentElement.dataset.theme })`);
                    if (m.s > m.w || m.style !== style || m.theme !== theme) overflow.push({ sizeName, style, theme, name, m });
                    await browser.screenshot(path.join(SHOTS, `${sizeName}-${style}-${theme}-${name}.png`));
                }
            }
        }
    }
    check("every screen in every look at both widths fits the screen and shows the look that was chosen (24 combinations of screen and look, 2 sizes)", overflow.length === 0, overflow.slice(0, 3));

    check("no errors in the browser console", browser.result.consoleErrors.length === 0, browser.result.consoleErrors.slice(0, 3));
}, path.join(HERE, "results", "app-screens.json"));
