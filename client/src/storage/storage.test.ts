import { describe, expect, test } from "vitest";
import { SCHEMA_VERSION } from "./model.ts";
import type { StoredPlan, StoredProfile } from "./model.ts";
import { AlreadySetUpError, createRepository, PlanExistsError, StorageTooNewError } from "./repository.ts";
import { createMemoryStore, PreconditionFailedError } from "./store.ts";
import type { KeyValueStore } from "./store.ts";
import { convertLegacyUser, LEGACY_CURRENT_KEY, LEGACY_USERS_KEY, migrateFromLegacy, readLegacy } from "./legacy.ts";

const NOW = new Date("2026-10-14T10:00:00.000Z");
const fixedNow = () => NOW;

const profile: StoredProfile = { id: "u1", name: "Arta", educationLevel: "university", school: "FSHMN", createdAt: "2026-09-01T08:00:00.000Z" };

const session = (id: string, status = "pending", date = "2026-10-14") => ({
    id, status, date, startTime: "08:00", endTime: "09:00", type: "learning", title: "Seancë " + id, goal: "Qëllimi", tasks: ["Një"], material: null, difficulty: "medium",
});

const plan = (id: string, createdAt = "2026-10-01T08:00:00.000Z", sessions: unknown[] = [session("s1"), session("s2", "completed")]): StoredPlan =>
    ({
        id, createdAt, subject: "Matematikë", startDate: "2026-10-12", endDate: "2026-10-30", planMode: "exam",
        strategy: "Strategjia", explanations: ["Sepse"], warnings: [], structured: { startDate: "2026-10-12", endDate: "2026-10-30", subject: "Matematikë" }, sessions,
    }) as StoredPlan;

/** The exact shape public/script.js writes. */
const legacyUser = (overrides: Record<string, unknown> = {}) => ({
    id: "legacy-1", name: "  Arta Krasniqi ", email: "arta@example.test", password: "hunter22", educationLevel: "university", school: "FSHMN",
    createdAt: "2026-09-01T08:00:00.000Z",
    plans: [
        {
            ...plan("p1"),
            profile: { name: "Arta Krasniqi" },
            stats: { totalSessions: 2, totalMinutes: 120, totalHours: 2 },
        },
    ],
    ...overrides,
});

const legacyStorage = (current: unknown, users: unknown) => {
    const items: Record<string, string> = {};
    if (current !== undefined) items[LEGACY_CURRENT_KEY] = typeof current === "string" ? current : JSON.stringify(current);
    if (users !== undefined) items[LEGACY_USERS_KEY] = typeof users === "string" ? users : JSON.stringify(users);
    return { getItem: (key: string) => items[key] ?? null, items };
};

describe("repository", () => {
    test("an empty device is not set up and has nothing to list", async () => {
        const repo = createRepository(createMemoryStore(), fixedNow);
        expect(await repo.isSetUp()).toBe(false);
        expect(await repo.getProfile()).toBeNull();
        expect(await repo.listPlans()).toEqual({ plans: [], unreadable: [] });
        expect(await repo.readMeta()).toBeNull();
    });

    test("initialise writes meta, profile and plans together; a second initialise is refused", async () => {
        const store = createMemoryStore();
        const repo = createRepository(store, fixedNow);

        await repo.initialise(profile, [plan("p1"), plan("p2")], { fromLegacy: false });

        expect(await repo.isSetUp()).toBe(true);
        expect(await repo.readMeta()).toEqual({ schemaVersion: SCHEMA_VERSION, createdAt: NOW.toISOString(), migratedFromLegacyAt: null });
        expect(Object.keys(store.dump()).sort()).toEqual(["meta", "plan:p1", "plan:p2", "profile"]);
        await expect(repo.initialise(profile, [], { fromLegacy: false })).rejects.toThrow("already_set_up");
    });

    test("if the first write fails, nothing at all is stored", async () => {
        const store = createMemoryStore();
        store.failNextCommit();
        await expect(createRepository(store, fixedNow).initialise(profile, [plan("p1")], { fromLegacy: true })).rejects.toThrow();
        expect(store.dump()).toEqual({});
    });

    test("plans come back newest first and round-trip unchanged", async () => {
        const repo = createRepository(createMemoryStore(), fixedNow);
        const older = plan("old", "2026-09-01T08:00:00.000Z");
        const newer = plan("new", "2026-10-10T08:00:00.000Z");
        await repo.initialise(profile, [older, newer], { fromLegacy: false });

        expect((await repo.listPlans()).plans).toEqual([newer, older]);
        expect(await repo.getPlan("old")).toEqual(older);
        expect(await repo.getPlan("missing")).toBeNull();
    });

    test("a damaged plan is reported and left in storage; the others still load", async () => {
        const store = createMemoryStore({ "plan:good": plan("good"), "plan:bad": { id: "bad", subject: 5 } });
        const repo = createRepository(store, fixedNow);

        const { plans, unreadable } = await repo.listPlans();

        expect(plans.map((p) => p.id)).toEqual(["good"]);
        expect(unreadable).toEqual([{ key: "plan:bad", reason: "createdAt" }]);
        expect(store.dump()["plan:bad"]).toEqual({ id: "bad", subject: 5 });
    });

    test("a session with an unknown status or kind is read as pending / learning rather than losing the plan", async () => {
        const odd = plan("p1", undefined, [{ ...session("s1"), status: "done?", type: "break" }]);
        const repo = createRepository(createMemoryStore({ "plan:p1": odd }), fixedNow);
        const read = await repo.getPlan("p1");
        expect([read?.sessions[0]?.status, read?.sessions[0]?.type]).toEqual(["pending", "learning"]);
    });

    test("saving a plan that fails the checks is refused and changes nothing", async () => {
        const store = createMemoryStore();
        const repo = createRepository(store, fixedNow);
        await repo.initialise(profile, [plan("p1")], { fromLegacy: false });
        const before = store.dump();

        await expect(repo.savePlan({ ...plan("p1"), startDate: "14.10.2026" })).rejects.toThrow();
        expect(store.dump()).toEqual(before);
    });

    test("marking a session changes that session only", async () => {
        const repo = createRepository(createMemoryStore(), fixedNow);
        await repo.initialise(profile, [plan("p1")], { fromLegacy: false });

        const updated = await repo.setSessionStatus("p1", "s1", "partial");

        expect(updated?.sessions.map((s) => s.status)).toEqual(["partial", "completed"]);
        expect((await repo.getPlan("p1"))?.sessions.map((s) => s.status)).toEqual(["partial", "completed"]);
        expect(await repo.setSessionStatus("p1", "nope", "completed")).toBeNull();
        expect(await repo.setSessionStatus("nope", "s1", "completed")).toBeNull();
    });

    test("a profile can never be stored with a password or an e-mail, whoever hands it over", async () => {
        const store = createMemoryStore();
        const repo = createRepository(store, fixedNow);
        const withSecrets = { ...profile, password: "hunter22", email: "arta@example.test", anythingElse: true } as StoredProfile;

        await repo.initialise(withSecrets, [], { fromLegacy: false });
        expect(store.dump().profile).toEqual(profile);

        await repo.saveProfile(withSecrets);
        expect(store.dump().profile).toEqual(profile);

        const restored = createMemoryStore();
        await createRepository(restored, fixedNow).restoreBackup({ format: "planifikues-kopje", schemaVersion: 1, exportedAt: "x", profile: withSecrets, plans: [] });
        expect(restored.dump().profile).toEqual(profile);
    });

    test("deleting a plan removes that plan only", async () => {
        const repo = createRepository(createMemoryStore(), fixedNow);
        await repo.initialise(profile, [plan("p1"), plan("p2")], { fromLegacy: false });
        await repo.deletePlan("p1");
        expect((await repo.listPlans()).plans.map((p) => p.id)).toEqual(["p2"]);
    });

    test("data written by a newer version of the app is not touched", async () => {
        const store = createMemoryStore({ meta: { schemaVersion: SCHEMA_VERSION + 1, createdAt: "x", migratedFromLegacyAt: null }, profile });
        const repo = createRepository(store, fixedNow);
        await expect(repo.readMeta()).rejects.toBeInstanceOf(StorageTooNewError);
        await expect(repo.isSetUp()).rejects.toBeInstanceOf(StorageTooNewError);
    });
});

describe("two tabs at once", () => {
    test("the store itself refuses a write whose precondition no longer holds, and changes nothing", async () => {
        const store = createMemoryStore({ profile });
        const before = store.dump();
        await expect(store.commit([{ key: "meta", value: 1 }, { key: "profile", value: 2 }], { onlyIfAbsent: ["profile"] })).rejects.toBeInstanceOf(PreconditionFailedError);
        expect(store.dump()).toEqual(before);
    });

    test("two first set-ups started together: exactly one wins and nothing of the other is stored", async () => {
        const store = createMemoryStore();
        const tabA = createRepository(store, fixedNow);
        const tabB = createRepository(store, fixedNow);

        const results = await Promise.allSettled([
            tabA.initialise({ ...profile, name: "Skeda A" }, [plan("a1"), plan("a2")], { fromLegacy: false }),
            tabB.initialise({ ...profile, name: "Skeda B" }, [plan("b1")], { fromLegacy: false }),
        ]);

        expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
        const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        expect(loser.reason).toBeInstanceOf(AlreadySetUpError);
        // Never a mixture of the two.
        expect(Object.keys(store.dump()).sort()).toEqual(["meta", "plan:a1", "plan:a2", "profile"]);
        expect((await tabA.getProfile())?.name).toBe("Skeda A");
    });

    test("the same, in the other order: whichever write lands first is kept whole", async () => {
        const store = createMemoryStore();
        const results = await Promise.allSettled([
            createRepository(store, fixedNow).initialise({ ...profile, name: "B" }, [plan("b1")], { fromLegacy: false }),
            createRepository(store, fixedNow).initialise({ ...profile, name: "A" }, [plan("a1"), plan("a2")], { fromLegacy: false }),
        ]);
        expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
        expect(Object.keys(store.dump()).sort()).toEqual(["meta", "plan:b1", "profile"]);
    });

    test("two tabs copying the old page's data together: one copies, the other finds it done, neither fails", async () => {
        const me = legacyUser();
        const store = createMemoryStore();
        const outcomes = await Promise.all([
            migrateFromLegacy(createRepository(store, fixedNow), legacyStorage(me, [me])),
            migrateFromLegacy(createRepository(store, fixedNow), legacyStorage(me, [me])),
        ]);
        expect(outcomes.map((o) => o.status).sort()).toEqual(["already_set_up", "migrated"]);
        expect(Object.keys(store.dump()).sort()).toEqual(["meta", "plan:p1", "profile"]);
    });

    test("a new plan never replaces a stored plan with the same id", async () => {
        const store = createMemoryStore();
        const repo = createRepository(store, fixedNow);
        await repo.initialise(profile, [{ ...plan("p1"), subject: "I pari" }], { fromLegacy: false });
        const before = store.dump();

        await expect(repo.createPlan({ ...plan("p1"), subject: "Ndërhyrësi" })).rejects.toBeInstanceOf(PlanExistsError);
        expect(store.dump()).toEqual(before);

        await repo.createPlan({ ...plan("p2"), subject: "I dyti" });
        expect((await repo.listPlans()).plans.map((p) => p.subject).sort()).toEqual(["I dyti", "I pari"]);
    });

    test("two tabs creating a plan under the same id at once: one is stored whole, the other is refused", async () => {
        const store = createMemoryStore();
        await createRepository(store, fixedNow).initialise(profile, [], { fromLegacy: false });

        const results = await Promise.allSettled([
            createRepository(store, fixedNow).createPlan({ ...plan("same", undefined, [session("a1")]), subject: "Skeda A" }),
            createRepository(store, fixedNow).createPlan({ ...plan("same", undefined, [session("b1"), session("b2")]), subject: "Skeda B" }),
        ]);

        expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
        expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(PlanExistsError);
        const kept = await createRepository(store, fixedNow).getPlan("same");
        expect([kept?.subject, kept?.sessions.map((s) => s.id)]).toEqual(["Skeda A", ["a1"]]);
    });

    test("an invalid new plan is refused before anything is written", async () => {
        const store = createMemoryStore();
        await expect(createRepository(store, fixedNow).createPlan({ ...plan("p1"), startDate: "nesër" })).rejects.toThrow();
        expect(store.dump()).toEqual({});
    });

    test("saving a changed plan still replaces the stored one on purpose", async () => {
        const repo = createRepository(createMemoryStore(), fixedNow);
        await repo.initialise(profile, [plan("p1")], { fromLegacy: false });
        await repo.savePlan({ ...plan("p1"), strategy: "E ndryshuar" });
        expect((await repo.getPlan("p1"))?.strategy).toBe("E ndryshuar");
    });

    test("a plan saved by another tab while a restore is being prepared does not survive the restore", async () => {
        const inner = createMemoryStore();
        await createRepository(inner, fixedNow).initialise(profile, [plan("old")], { fromLegacy: false });
        const otherTab = createRepository(inner, fixedNow);

        // The other tab's save lands at the last possible moment: after the restoring tab has read
        // everything it reads, immediately before its write. Deciding what to remove from an earlier
        // look at storage would leave this plan behind.
        const store: KeyValueStore = {
            get: (key) => inner.get(key),
            keys: (prefix) => inner.keys(prefix),
            commit: async (writes, options) => {
                await otherTab.savePlan(plan("saved-meanwhile"));
                return inner.commit(writes, options);
            },
        };
        await createRepository(store, fixedNow).restoreBackup({ format: "planifikues-kopje", schemaVersion: 1, exportedAt: "x", profile, plans: [plan("from-backup")] });

        expect((await otherTab.listPlans()).plans.map((p) => p.id)).toEqual(["from-backup"]);
    });
});

describe("the look chosen on this device", () => {
    test("nothing saved reads as null; what is saved is read back", async () => {
        const repo = createRepository(createMemoryStore(), fixedNow);
        expect(await repo.getAppearance()).toBeNull();
        await repo.saveAppearance({ layoutStyle: "blocks", colorMode: "dark" });
        expect(await repo.getAppearance()).toEqual({ layoutStyle: "blocks", colorMode: "dark" });
    });

    test("a damaged record reads as the defaults field by field, and saving cleans what is written", async () => {
        const store = createMemoryStore({ appearance: { layoutStyle: "blocks", colorMode: "purple", extra: 1 } });
        const repo = createRepository(store, fixedNow);
        expect(await repo.getAppearance()).toEqual({ layoutStyle: "notebook", colorMode: "light" });

        await repo.saveAppearance({ layoutStyle: "nope", colorMode: "light" } as never);
        expect(store.dump().appearance).toEqual({ layoutStyle: "notebook", colorMode: "light" });
    });

    test("the look is separate from the data: a restore and a profile save leave it alone", async () => {
        const store = createMemoryStore();
        const repo = createRepository(store, fixedNow);
        await repo.initialise(profile, [plan("p1")], { fromLegacy: false });
        await repo.saveAppearance({ layoutStyle: "blocks", colorMode: "dark" });
        await repo.restoreBackup({ format: "planifikues-kopje", schemaVersion: 1, exportedAt: "x", profile, plans: [] });
        await repo.saveProfile({ ...profile, name: "Besa" });
        expect(await repo.getAppearance()).toEqual({ layoutStyle: "blocks", colorMode: "dark" });
    });
});

describe("backup and restore", () => {
    test("plans that repeat an id inside the backup are not merged: the first is kept, the rest are counted", async () => {
        const repo = createRepository(createMemoryStore(), fixedNow);
        const first = { ...plan("same"), subject: "E para" };
        const second = { ...plan("same"), subject: "E dyta" };

        const summary = await repo.restoreBackup({ format: "planifikues-kopje", schemaVersion: 1, exportedAt: "x", profile, plans: [first, second, plan("other"), second] });

        expect(summary).toEqual({ plansImported: 2, plansRejected: 0, plansDuplicated: 2 });
        expect((await repo.getPlan("same"))?.subject).toBe("E para");
    });

    test("a first set-up given two plans with one id is refused whole", async () => {
        const store = createMemoryStore();
        await expect(createRepository(store, fixedNow).initialise(profile, [plan("same"), plan("same")], { fromLegacy: false })).rejects.toThrow("duplicate_plan_ids");
        expect(store.dump()).toEqual({});
    });

    test("a backup holds the profile and every plan, and restoring it on an empty device gives the same data", async () => {
        const source = createRepository(createMemoryStore(), fixedNow);
        await source.initialise(profile, [plan("p1"), plan("p2", "2026-10-05T08:00:00.000Z")], { fromLegacy: false });

        const backup = await source.exportBackup();
        expect(backup).toMatchObject({ format: "planifikues-kopje", schemaVersion: SCHEMA_VERSION, exportedAt: NOW.toISOString(), profile });
        expect(JSON.stringify(backup)).not.toMatch(/password|email/i);

        const target = createRepository(createMemoryStore(), fixedNow);
        const summary = await target.restoreBackup(JSON.parse(JSON.stringify(backup)));

        expect(summary).toEqual({ plansImported: 2, plansRejected: 0, plansDuplicated: 0 });
        expect(await target.getProfile()).toEqual(profile);
        expect(await target.listPlans()).toEqual(await source.listPlans());
        expect(await target.isSetUp()).toBe(true);
    });

    test("restoring replaces what was there: plans not in the backup are removed", async () => {
        const repo = createRepository(createMemoryStore(), fixedNow);
        await repo.initialise(profile, [plan("old")], { fromLegacy: false });
        const backup = { format: "planifikues-kopje", schemaVersion: 1, exportedAt: "x", profile: { ...profile, name: "Besa" }, plans: [plan("new")] };

        await repo.restoreBackup(backup);

        expect((await repo.listPlans()).plans.map((p) => p.id)).toEqual(["new"]);
        expect((await repo.getProfile())?.name).toBe("Besa");
    });

    test("a file that is not a backup changes nothing", async () => {
        const store = createMemoryStore();
        const repo = createRepository(store, fixedNow);
        await repo.initialise(profile, [plan("p1")], { fromLegacy: false });
        const before = store.dump();

        for (const bad of [null, "text", {}, { format: "something-else", schemaVersion: 1, exportedAt: "x", profile, plans: [] }, { format: "planifikues-kopje", schemaVersion: 1, exportedAt: "x", profile: { name: "" }, plans: [] }]) {
            await expect(repo.restoreBackup(bad)).rejects.toThrow();
        }
        expect(store.dump()).toEqual(before);
    });

    test("a backup from a newer version is refused; damaged plans inside a good backup are skipped and counted", async () => {
        const repo = createRepository(createMemoryStore(), fixedNow);
        const base = { format: "planifikues-kopje", exportedAt: "x", profile };
        await expect(repo.restoreBackup({ ...base, schemaVersion: SCHEMA_VERSION + 1, plans: [] })).rejects.toBeInstanceOf(StorageTooNewError);
        expect(await repo.restoreBackup({ ...base, schemaVersion: 1, plans: [plan("ok"), { id: "broken" }] })).toEqual({ plansImported: 1, plansRejected: 1, plansDuplicated: 0 });
    });

    test("if the restore write fails, the device keeps what it had", async () => {
        const store = createMemoryStore();
        const repo = createRepository(store, fixedNow);
        await repo.initialise(profile, [plan("p1")], { fromLegacy: false });
        const before = store.dump();
        store.failNextCommit();

        await expect(repo.restoreBackup({ format: "planifikues-kopje", schemaVersion: 1, exportedAt: "x", profile, plans: [plan("p9")] })).rejects.toThrow();
        expect(store.dump()).toEqual(before);
    });
});

describe("reading the old page's data", () => {
    test("no keys: nothing to migrate", () => {
        expect(readLegacy(legacyStorage(undefined, undefined))).toEqual({ status: "none" });
        expect(readLegacy(legacyStorage(undefined, []))).toEqual({ status: "none" });
    });

    test("the signed-in user is found, and other accounts on the device are counted", () => {
        const me = legacyUser();
        const other = legacyUser({ id: "legacy-2", name: "Dikush tjetër" });
        const read = readLegacy(legacyStorage(me, [me, other]));
        expect(read).toMatchObject({ status: "found", otherAccounts: 1 });
        expect(read.status === "found" && read.user.id).toBe("legacy-1");
    });

    test("signed out with one account: that account; with several: the person must choose", () => {
        const one = legacyUser();
        expect(readLegacy(legacyStorage(undefined, [one]))).toMatchObject({ status: "found", otherAccounts: 0 });

        const two = legacyUser({ id: "legacy-2", name: "Besa", plans: [] });
        expect(readLegacy(legacyStorage(undefined, [one, two]))).toEqual({
            status: "choose",
            candidates: [
                { id: "legacy-1", name: "  Arta Krasniqi ", plans: 1 },
                { id: "legacy-2", name: "Besa", plans: 0 },
            ],
        });
    });

    test("damaged JSON never throws: the other key is used if it is intact, otherwise it is reported", () => {
        const me = legacyUser();
        expect(readLegacy(legacyStorage("{not json", [me]))).toMatchObject({ status: "found" });
        expect(readLegacy(legacyStorage(me, "{not json"))).toMatchObject({ status: "found" });
        expect(readLegacy(legacyStorage("{not json", "[also not"))).toEqual({ status: "unreadable", reason: "json" });
        expect(readLegacy(legacyStorage("null", "{}"))).toEqual({ status: "none" });
    });

    test("if the two copies of the user differ, the one with more plans wins", () => {
        const stale = legacyUser({ plans: [] });
        const full = legacyUser();
        const read = readLegacy(legacyStorage(stale, [full]));
        expect(read.status === "found" && (read.user.plans as unknown[]).length).toBe(1);
    });
});

describe("converting an old user", () => {
    test("profile and plans carry over; the password and the e-mail do not", () => {
        const { profile: converted, plans, rejected, sessionIdsRepaired } = convertLegacyUser(legacyUser(), () => "new-id", fixedNow);

        expect(converted).toEqual({ id: "legacy-1", name: "Arta Krasniqi", educationLevel: "university", school: "FSHMN", createdAt: "2026-09-01T08:00:00.000Z" });
        expect(plans).toEqual([plan("p1")]);
        expect([rejected, sessionIdsRepaired]).toEqual([[], 0]);
        expect(JSON.stringify({ converted, plans })).not.toMatch(/hunter22|password|arta@example\.test/);
    });

    test("every session keeps its status, times and text exactly", () => {
        const statuses = ["pending", "completed", "partial", "skipped"];
        const sessions = statuses.map((status, i) => session("s" + i, status, `2026-10-1${i}`));
        const { plans } = convertLegacyUser(legacyUser({ plans: [plan("p1", undefined, sessions)] }), () => "new-id", fixedNow);
        expect(plans[0]?.sessions).toEqual(sessions);
    });

    test("duplicate session ids left by the old server are repaired: the first keeps its id, later ones get new ones", () => {
        let n = 0;
        const sessions = [session("a1", "completed", "2026-10-10"), session("a2"), session("a1", "pending", "2026-10-15"), session("a1", "skipped", "2026-10-16")];
        const result = convertLegacyUser(legacyUser({ plans: [plan("p1", undefined, sessions)] }), () => `fresh-${++n}`, fixedNow);

        expect(result.plans[0]?.sessions.map((s) => [s.id, s.status])).toEqual([["a1", "completed"], ["a2", "pending"], ["fresh-1", "pending"], ["fresh-2", "skipped"]]);
        expect(result.sessionIdsRepaired).toBe(2);
    });

    test("a replacement id never repeats an id already in the plan, even one further down or just handed out", () => {
        // The generator first offers ids that are taken: one used later in the list, then its own previous answer.
        const offers = ["z9", "fresh-1", "fresh-1", "fresh-2"];
        const sessions = [session("a1"), session("a1"), session("a1"), session("z9")];
        const result = convertLegacyUser(legacyUser({ plans: [plan("p1", undefined, sessions)] }), () => offers.shift() ?? "exhausted", fixedNow);

        const ids = result.plans[0]?.sessions.map((s) => s.id) ?? [];
        expect(ids).toEqual(["a1", "fresh-1", "fresh-2", "z9"]);
        expect(new Set(ids).size).toBe(4);
    });

    test("the same for plan ids", () => {
        const offers = ["later", "fresh"];
        const result = convertLegacyUser(legacyUser({ plans: [plan("same"), plan("same"), plan("later")] }), () => offers.shift() ?? "exhausted", fixedNow);
        expect(result.plans.map((p) => p.id)).toEqual(["same", "fresh", "later"]);
    });

    test("a generator that cannot produce an unused id stops the conversion instead of storing duplicates", () => {
        const sessions = [session("a1"), session("a1")];
        expect(() => convertLegacyUser(legacyUser({ plans: [plan("p1", undefined, sessions)] }), () => "a1", fixedNow)).toThrow("id_generator_keeps_colliding");
    });

    test("statuses and kinds this app does not know are stored as no progress and counted, not passed off as real", () => {
        const sessions = [session("s1", "completed"), { ...session("s2"), status: "done" }, { ...session("s3"), status: undefined }, { ...session("s4", "partial"), type: "break" }];
        const result = convertLegacyUser(legacyUser({ plans: [plan("p1", undefined, sessions)] }), () => "new-id", fixedNow);

        expect(result.plans[0]?.sessions.map((s) => [s.status, s.type])).toEqual([["completed", "learning"], ["pending", "learning"], ["pending", "learning"], ["partial", "learning"]]);
        expect([result.sessionsWithUnknownStatus, result.sessionsWithUnknownKind]).toEqual([2, 1]);
    });

    test("unknown values in a plan that is rejected anyway are not counted", () => {
        const broken = plan("p1", undefined, [{ ...session("s1"), status: "done", startTime: "8" }]);
        const result = convertLegacyUser(legacyUser({ plans: [broken] }), () => "new-id", fixedNow);
        expect([result.plans.length, result.sessionsWithUnknownStatus]).toEqual([0, 0]);
    });

    test("a plan that cannot be read is listed by its subject, and the good plans still come over", () => {
        const broken = { ...plan("p2"), subject: "Kimi", startDate: "pa datë" };
        const result = convertLegacyUser(legacyUser({ plans: [plan("p1"), broken, "nonsense", { ...plan("p3"), sessions: [{ ...session("s1"), startTime: "8" }] }] }), () => "new-id", fixedNow);

        expect(result.plans.map((p) => p.id)).toEqual(["p1"]);
        expect(result.rejected).toEqual([
            { subject: "Kimi", reason: "startDate" },
            { subject: "", reason: "not_an_object" },
            { subject: "Matematikë", reason: "sessions.0.startTime" },
        ]);
    });

    test("missing pieces get safe values: no name, no ids, no dates, no plans", () => {
        let n = 0;
        const result = convertLegacyUser({ plans: [{ ...plan("x"), id: undefined, createdAt: undefined, structured: "broken" }] }, () => `id-${++n}`, fixedNow);
        expect(result.profile).toEqual({ id: "id-1", name: "No name", educationLevel: null, school: "", createdAt: NOW.toISOString() });
        expect(result.plans[0]).toMatchObject({ id: "id-2", createdAt: NOW.toISOString(), structured: {} });
        expect(convertLegacyUser({}, () => "id", fixedNow).plans).toEqual([]);
    });

    test("two plans with the same id both survive, the second under a new id", () => {
        const result = convertLegacyUser(legacyUser({ plans: [plan("same"), plan("same")] }), () => "fresh", fixedNow);
        expect(result.plans.map((p) => p.id)).toEqual(["same", "fresh"]);
    });
});

describe("migration on first start", () => {
    test("old data is copied in, and the old keys are left exactly as they were", async () => {
        const me = legacyUser();
        const storage = legacyStorage(me, [me]);
        const before = { ...storage.items };
        const store = createMemoryStore();
        const repo = createRepository(store, fixedNow);

        const outcome = await migrateFromLegacy(repo, storage);

        expect(outcome).toEqual({ status: "migrated", plans: 1, rejected: [], sessionIdsRepaired: 0, sessionsWithUnknownStatus: 0, sessionsWithUnknownKind: 0, otherAccounts: 0 });
        expect(await repo.getProfile()).toMatchObject({ id: "legacy-1", name: "Arta Krasniqi" });
        expect((await repo.listPlans()).plans).toEqual([plan("p1")]);
        expect((await repo.readMeta())?.migratedFromLegacyAt).toBe(NOW.toISOString());
        expect(storage.items).toEqual(before);
        expect(JSON.stringify(store.dump())).not.toMatch(/hunter22|password|arta@example\.test/);
    });

    test("running it again does nothing, even if the old data has changed since", async () => {
        const me = legacyUser();
        const repo = createRepository(createMemoryStore(), fixedNow);
        await migrateFromLegacy(repo, legacyStorage(me, [me]));

        const changed = legacyUser({ name: "Tjetër", plans: [] });
        expect(await migrateFromLegacy(repo, legacyStorage(changed, [changed]))).toEqual({ status: "already_set_up" });
        expect((await repo.getProfile())?.name).toBe("Arta Krasniqi");
    });

    test("nothing old, or old data that cannot be read: nothing is written", async () => {
        const store = createMemoryStore();
        const repo = createRepository(store, fixedNow);
        expect(await migrateFromLegacy(repo, legacyStorage(undefined, undefined))).toEqual({ status: "nothing_to_migrate" });
        expect(await migrateFromLegacy(repo, legacyStorage("{bad", "{bad"))).toEqual({ status: "unreadable", reason: "json" });
        expect(store.dump()).toEqual({});
    });

    test("several signed-out accounts: nothing is copied until the person chooses one", async () => {
        const one = legacyUser();
        const two = legacyUser({ id: "legacy-2", name: "Besa", plans: [] });
        const storage = legacyStorage(undefined, [one, two]);
        const store = createMemoryStore();
        const repo = createRepository(store, fixedNow);

        expect((await migrateFromLegacy(repo, storage)).status).toBe("choose");
        expect(store.dump()).toEqual({});

        expect(await migrateFromLegacy(repo, storage, "legacy-2")).toMatchObject({ status: "migrated", plans: 0, otherAccounts: 1 });
        expect((await repo.getProfile())?.name).toBe("Besa");
    });

    test("if the write fails, the device stays empty and the next start tries again", async () => {
        const me = legacyUser();
        const store = createMemoryStore();
        const repo = createRepository(store, fixedNow);
        store.failNextCommit();

        await expect(migrateFromLegacy(repo, legacyStorage(me, [me]))).rejects.toThrow();
        expect(store.dump()).toEqual({});
        expect((await migrateFromLegacy(repo, legacyStorage(me, [me]))).status).toBe("migrated");
    });
});
