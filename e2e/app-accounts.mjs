/**
 * The account screens against a real server in memory mode, in a real browser: sign-up with its
 * refusals, the e-mail link, sign-in, staying signed in across a reload, devices, sign-out, and the
 * whole forgotten-password path.
 *
 *   npm run client:build
 *   ACCOUNTS_MODE=memory ACCOUNTS_PWNED_CHECK=off PORT=3987 OPENROUTER_API_KEY= node server.js
 *   node e2e/app-accounts.mjs [baseUrl]
 *
 * The server's test mailer appends each message to dev-mail/outbox.jsonl in the project folder
 * (git-ignored); this journey reads the links from there, as a developer would. No real mail is sent.
 * Result: e2e/results/app-accounts.json. Exit code 1 on any failure.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser, sleep } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] ?? "http://127.0.0.1:3987").replace(/\/$/, "");
const OUTBOX = path.join(HERE, "..", "dev-mail", "outbox.jsonl");

const EMAIL = `journey-${Date.now().toString(36)}@example.test`;
const PASSWORD = "een lange zin die niemand raadt";
const NEW_PASSWORD = "weer een andere lange zin hier";

const browser = await openBrowser({ debugPort: 9357, width: 390, height: 844, mobile: true });
const { evaluate, goto, waitFor, check } = browser;

const mailTo = (kind) => {
    if (!existsSync(OUTBOX)) return [];
    return readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.to === EMAIL && m.kind === kind);
};
const waitForMail = async (kind, count) => {
    for (let i = 0; i < 50; i++) {
        if (mailTo(kind).length >= count) return mailTo(kind).at(-1);
        await sleep(100);
    }
    throw new Error(`no ${kind} mail for ${EMAIL}`);
};
const linkPath = (link) => link.replace(/^https?:\/\/[^/]+/, "");

// A link that differs from the current address only by its #fragment is not a page load, so leave the page first.
const open = async (url) => {
    await goto("about:blank");
    await goto(url);
};

const ready = () => waitFor(`Boolean(document.querySelector("main h1"))`, "a screen");
const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null`);
const bodyText = () => text("main");
/** Types into a labelled control the way a person does, so that React sees it. */
const fill = (label, value) =>
    evaluate(`(() => {
        const l = [...document.querySelectorAll("main label")].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)}));
        const el = document.getElementById(l.htmlFor);
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
// Waits until the control is there and enabled (a form button stays disabled while the server is still being asked about accounts).
const press = async (label) => {
    await waitFor(`(() => { const b = [...document.querySelectorAll("main button, main a")].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); return Boolean(b) && !b.disabled; })()`, `the "${label}" control to be usable`);
    await evaluate(`[...document.querySelectorAll("main button, main a")].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
};
const tickAge = () => evaluate(`(() => { const c = document.querySelector('main input[type=checkbox]'); if (!c.checked) c.click(); })()`);

await browser.run(async () => {
    browser.result.base = BASE;

    /* ---------- before signing in ---------- */
    await goto(BASE + "/app/settings");
    await ready();
    await waitFor(`Boolean(document.querySelector('section[aria-label="Account"] a'))`, "the account panel");
    check("settings: says plainly that accounts are a demo kept in memory", (await bodyText()).includes("lost whenever it restarts"), await text('section[aria-label="Account"]'));
    check("settings: offers sign-in and sign-up", (await evaluate(`[...document.querySelectorAll('section[aria-label="Account"] a')].map((a) => a.textContent).join()`)) === "Sign in,Sign up");

    /* ---------- sign-up, refused ---------- */
    await goto(BASE + "/app/sign-up");
    await ready();
    check("sign-up: discloses the leaked-password lookup and the external AI before anything is typed", (await bodyText()).includes("Have I Been Pwned") && (await bodyText()).includes("outside AI provider"));

    await fill("Name", "Arta");
    await fill("E-mail", "not-an-email");
    await fill("Password", PASSWORD);
    await tickAge();
    await press("Create account");
    await waitFor(`document.querySelector('main [id$="-error"]') !== null`, "an error");
    check("sign-up: a bad e-mail is refused beside the e-mail field", (await text('main [id$="-error"]'))?.includes("name@example.com"), await text('main [id$="-error"]'));

    await fill("E-mail", EMAIL);
    await fill("Password", "short");
    await press("Create account");
    await waitFor(`[...document.querySelectorAll('main [id$="-error"]')].some((e) => e.textContent.includes("at least 8 characters"))`, "the password error");
    check("sign-up: a short password is refused beside the password field, with the reason", true);

    await fill("Password", PASSWORD);
    await evaluate(`document.querySelector('main input[type=checkbox]').click()`); // untick
    await press("Create account");
    await waitFor(`document.body.textContent.includes("16 and over")  && document.querySelector('main input[type=checkbox]')?.getAttribute("aria-invalid") === "true"`, "the age error");
    check("sign-up: without the 16-and-over declaration it is refused", true);

    /* ---------- sign-up, accepted ---------- */
    await tickAge();
    await press("Create account");
    await waitFor(`document.querySelector("main h1")?.textContent === "Check your e-mail"`, "the confirmation");
    check("sign-up: the answer does not say whether the address was new", !(await bodyText()).includes("was created") && (await bodyText()).includes("If "));
    const verification = await waitForMail("verification", 1);
    check("the verification link is built from the configured address and carries its token in the fragment", /\/app\/verify#token=[A-Za-z0-9_-]{20,}$/.test(verification.link), verification.link.replace(/token=.*/, "token=…"));

    /* ---------- verifying ---------- */
    await open(BASE + linkPath(verification.link));
    await waitFor(`document.querySelector('main [role=status]')?.textContent.includes("E-mail confirmed")`, "the verification result");
    check("verify: the link confirms the address", true);
    check("verify: the token is gone from the address bar and the history", (await evaluate(`window.location.hash`)) === "");

    await open(BASE + linkPath(verification.link));
    await waitFor(`document.querySelector('main [role=alert]') !== null`, "the second use to be refused");
    check("verify: the same link used again is refused", (await text("main [role=alert]"))?.includes("not valid or has expired"));

    /* ---------- sign-in ---------- */
    await goto(BASE + "/app/sign-in");
    await ready();
    await fill("E-mail", EMAIL);
    await fill("Password", "wrong wrong wrong wrong");
    await press("Sign in");
    await waitFor(`document.querySelector('main [role=alert]') !== null`, "the refusal");
    check("sign-in: a wrong password says only that the e-mail or password is wrong", (await text("main [role=alert]")) === "The e-mail or password is not correct.", await text("main [role=alert]"));

    await fill("E-mail", "askush@example.test");
    await fill("Password", "wrong wrong wrong wrong");
    await press("Sign in");
    await waitFor(`document.querySelector('main [role=alert]')?.textContent === "The e-mail or password is not correct."`, "the same refusal").catch(() => undefined);
    await sleep(300);
    check("sign-in: an unknown address gets exactly the same message", (await text("main [role=alert]")) === "The e-mail or password is not correct.");

    await fill("E-mail", EMAIL);
    await fill("Password", PASSWORD);
    await press("Sign in");
    await waitFor(`location.pathname === "/app/settings"`, "the redirect to settings");
    await waitFor(`document.querySelector('section[aria-label="Account"]')?.textContent.includes(${JSON.stringify(EMAIL)})`, "the signed-in panel");
    check("sign-in: lands on settings showing the person's name and e-mail", (await text('section[aria-label="Account"]')).includes("Arta"));
    check("the session cookie is not readable by the page's own script", !(await evaluate(`document.cookie`)).includes("orari_session"));

    await goto(BASE + "/app/settings");
    await ready();
    await waitFor(`document.querySelector('section[aria-label="Account"]')?.textContent.includes(${JSON.stringify(EMAIL)})`, "the panel after a reload");
    check("a reload keeps the person signed in", true);
    check("the device list and the sync buttons are gone", !(await bodyText()).includes("Get plans from") && !(await bodyText()).includes("Send the plans"));
    check("the log out button is the last control of the settings screen", (await evaluate(`[...document.querySelectorAll("main button")].pop().textContent.trim()`)) === "Log out");

    /* ---------- editing the account ---------- */
    await evaluate(`(() => { const i = document.querySelector('[data-testid=account-name] input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Arta Krasniqi'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await evaluate(`[...document.querySelectorAll('[data-testid=account-name] button')].find((b) => b.textContent.includes('Save name')).click()`);
    await waitFor(`document.querySelector('[data-testid=account-name]')?.textContent.includes("Name saved.")`, "the name saved");
    await waitFor(`document.querySelector('section[aria-label="Account"]')?.textContent.includes("Arta Krasniqi")`, "the new name shown");
    check("account: the name can be changed and is saved", true);

    await press("Log out");
    await waitFor(`document.querySelector('section[aria-label="Account"]')?.textContent.includes("Sign up")`, "the signed-out panel");
    await goto(BASE + "/app/settings");
    await ready();
    await waitFor(`Boolean(document.querySelector('section[aria-label="Account"] a'))`, "the panel");
    check("sign-out: stays signed out after a reload", (await text('section[aria-label="Account"]')).includes("Sign in"));

    /* ---------- forgotten password ---------- */
    await goto(BASE + "/app/forgot");
    await ready();
    await fill("Account e-mail", "askush@example.test");
    await press("Send the link");
    await waitFor(`document.querySelector('main [role=status]') !== null`, "the answer");
    const unknownAnswer = await text("main [role=status]");
    check("forgot: an unknown address gets the same answer and no mail", mailTo("reset").length === 0 && unknownAnswer.includes("If there is an account"), unknownAnswer);

    await goto(BASE + "/app/forgot");
    await ready();
    await fill("Account e-mail", EMAIL);
    await press("Send the link");
    await waitFor(`document.querySelector('main [role=status]') !== null`, "the answer");
    check("forgot: the known address gets word for word the same answer", (await text("main [role=status]")) === unknownAnswer);
    const reset = await waitForMail("reset", 1);

    await open(BASE + linkPath(reset.link));
    await ready();
    await fill("New password", "short");
    await fill("Repeat it", "short");
    await press("Set the password");
    await waitFor(`[...document.querySelectorAll('main [id$="-error"]')].some((e) => e.textContent.includes("at least 8 characters"))`, "the weak-password error");
    check("reset: a weak password is refused and the link is not used up", true);
    check("reset: the token is already out of the address bar", (await evaluate(`window.location.hash`)) === "");

    await fill("New password", NEW_PASSWORD);
    await fill("Repeat it", NEW_PASSWORD + "x");
    await sleep(200);
    check("reset: two different entries are caught before sending", (await bodyText()).includes("The two passwords are not the same") && (await evaluate(`[...document.querySelectorAll("main button")].find((b) => b.textContent.includes("Set the password")).disabled`)));

    await fill("Repeat it", NEW_PASSWORD);
    await press("Set the password");
    await waitFor(`document.querySelector("main h1")?.textContent === "Password changed"`, "the success");
    check("reset: succeeds with the same link, and does not sign the person in", (await text("main"))?.includes("We did not sign you in"));

    // The same page without a token in its address (as after the page removed it, or a mistyped link).
    await open(BASE + "/app/reset");
    await ready();
    check("reset: the page opened without a token says the link is incomplete and offers a new one", (await bodyText()).includes("is incomplete") && (await bodyText()).includes("Ask for a new link"));

    // And the used link, opened whole, is refused when submitted.
    await open(BASE + linkPath(reset.link));
    await ready();
    await fill("New password", "another long sentence for the test");
    await fill("Repeat it", "another long sentence for the test");
    await press("Set the password");
    await waitFor(`document.querySelector('main [role=alert]') !== null`, "the refusal of the used link");
    check("reset: a link that was already used is refused", (await text("main [role=alert]"))?.includes("not valid or has expired"), await text("main [role=alert]"));

    await goto(BASE + "/app/sign-in");
    await ready();
    await fill("E-mail", EMAIL);
    await fill("Password", PASSWORD);
    await press("Sign in");
    await waitFor(`document.querySelector('main [role=alert]') !== null`, "the refusal");
    check("sign-in: the old password no longer works", true);
    await fill("Password", NEW_PASSWORD);
    await press("Sign in");
    await waitFor(`location.pathname === "/app/settings"`, "the redirect");
    check("sign-in: the new password works", true);

    /* ---------- the planner itself is unaffected ---------- */
    await goto(BASE + "/app/");
    await ready();
    check("the planner opens as before for a signed-in person", (await text("h1")) === "Today");

    check("no errors in the browser console", browser.result.consoleErrors.length === 0, browser.result.consoleErrors.slice(0, 3));
}, (mkdirSync(path.join(HERE, "results"), { recursive: true }), path.join(HERE, "results", "app-accounts.json")));
