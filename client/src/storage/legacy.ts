/**
 * Copying a person's data from the old page (localStorage keys studyflow_users and
 * studyflow_current_user) into the new storage.
 *
 * What is carried over: name, education level, school, and every plan with its sessions and their status.
 * What is not: the password and the e-mail address. There is no account any more; the data stays on
 * this device. The old keys are only read here, never changed or removed; that happens at cutover.
 */
import { SESSION_KINDS, SESSION_STATUSES, StoredPlan, StoredProfile } from "./model.ts";
import { AlreadySetUpError } from "./repository.ts";
import type { Repository } from "./repository.ts";

export const LEGACY_USERS_KEY = "studyflow_users";
export const LEGACY_CURRENT_KEY = "studyflow_current_user";

type ReadableStorage = Pick<Storage, "getItem">;

export interface RejectedPlan {
    /** The plan's subject if it had one, to tell the person which plan it was. */
    subject: string;
    reason: string;
}

export interface LegacyConversion {
    profile: StoredProfile;
    plans: StoredPlan[];
    rejected: RejectedPlan[];
    /** Sessions whose id was shared with another session of the same plan and got a new one. */
    sessionIdsRepaired: number;
    /**
     * Sessions whose status or kind was not one this app knows. They are stored as "pending" and
     * "learning", which claims no progress, and counted here so the person can be told instead of
     * the change passing unnoticed.
     */
    sessionsWithUnknownStatus: number;
    sessionsWithUnknownKind: number;
}

export type LegacyRead =
    | { status: "none" }
    | { status: "unreadable"; reason: string }
    /** Several old accounts on this device and none of them signed in: the person has to say which one is theirs. */
    | { status: "choose"; candidates: { id: string; name: string; plans: number }[] }
    | { status: "found"; user: Record<string, unknown>; otherAccounts: number };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseJson(text: string | null): { ok: true; value: unknown } | { ok: false } {
    if (text === null) return { ok: true, value: null };
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch {
        return { ok: false };
    }
}

/** Finds the old page's signed-in user, without ever throwing on damaged data. */
export function readLegacy(storage: ReadableStorage): LegacyRead {
    const current = parseJson(storage.getItem(LEGACY_CURRENT_KEY));
    const list = parseJson(storage.getItem(LEGACY_USERS_KEY));

    const users = list.ok && Array.isArray(list.value) ? list.value.filter(isRecord) : [];

    if (current.ok && isRecord(current.value)) {
        const user = current.value;
        // The list is written on every change and the "current" copy with it; if they ever differ, prefer the one with more plans.
        const twin = users.find((u) => u.id === user.id);
        const count = (u: Record<string, unknown>) => (Array.isArray(u.plans) ? u.plans.length : 0);
        const chosen = twin && count(twin) > count(user) ? twin : user;
        return { status: "found", user: chosen, otherAccounts: users.filter((u) => u.id !== user.id).length };
    }

    if (users.length === 1) return { status: "found", user: users[0]!, otherAccounts: 0 };
    if (users.length > 1) {
        return {
            status: "choose",
            candidates: users.map((u) => ({ id: String(u.id ?? ""), name: String(u.name ?? ""), plans: Array.isArray(u.plans) ? u.plans.length : 0 })),
        };
    }

    if (!current.ok || !list.ok) return { status: "unreadable", reason: "json" };
    return { status: "none" };
}

/** One old user to a profile and plans. Pure: no storage, no clock except for missing dates. */
export function convertLegacyUser(user: Record<string, unknown>, newId: () => string = () => crypto.randomUUID(), now: () => Date = () => new Date()): LegacyConversion {
    const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

    const profile = StoredProfile.parse({
        id: text(user.id, 100) || newId(),
        name: text(user.name, 80) || "Pa emër",
        educationLevel: text(user.educationLevel, 40) || null,
        school: text(user.school, 120),
        createdAt: text(user.createdAt, 40) || now().toISOString(),
    });

    const plans: StoredPlan[] = [];
    const rejected: RejectedPlan[] = [];
    let sessionIdsRepaired = 0;
    let sessionsWithUnknownStatus = 0;
    let sessionsWithUnknownKind = 0;

    const rawPlans = (Array.isArray(user.plans) ? user.plans : []) as unknown[];

    // A replacement id must differ from every id in use, including ones that appear further down the
    // list and ones handed out a moment ago. The generator is random, but "random" is not "checked".
    const fresh = (taken: Set<string>): string => {
        for (let attempt = 0; attempt < 50; attempt++) {
            const id = newId();
            if (id && !taken.has(id)) {
                taken.add(id);
                return id;
            }
        }
        throw new Error("id_generator_keeps_colliding");
    };

    const planIds = new Set<string>();
    const allPlanIds = new Set(rawPlans.filter(isRecord).map((p) => text(p.id, 100)).filter(Boolean));

    for (const raw of rawPlans) {
        const subject = isRecord(raw) ? text(raw.subject, 200) : "";
        if (!isRecord(raw)) {
            rejected.push({ subject, reason: "not_an_object" });
            continue;
        }

        // The old server numbered sessions from 1 on every adjustment, so one plan can hold the same id twice.
        // Ticking one of them would change the other; later duplicates get a fresh id.
        const rawSessions = (Array.isArray(raw.sessions) ? raw.sessions : []).filter(isRecord);
        const seen = new Set<string>();
        const taken = new Set(rawSessions.map((s) => text(s.id, 100)).filter(Boolean));
        let unknownStatus = 0;
        let unknownKind = 0;
        const sessions = rawSessions.map((session) => {
            let id = text(session.id, 100);
            if (!id || seen.has(id)) {
                id = fresh(taken);
                sessionIdsRepaired++;
            }
            seen.add(id);
            if (!(SESSION_STATUSES as readonly unknown[]).includes(session.status)) unknownStatus++;
            if (!(SESSION_KINDS as readonly unknown[]).includes(session.type)) unknownKind++;
            return { ...session, id };
        });

        let id = text(raw.id, 100);
        if (!id || planIds.has(id)) id = fresh(allPlanIds);

        const parsed = StoredPlan.safeParse({
            ...raw,
            id,
            createdAt: text(raw.createdAt, 40) || now().toISOString(),
            structured: isRecord(raw.structured) ? raw.structured : {},
            sessions,
        });

        if (parsed.success) {
            planIds.add(id);
            plans.push(parsed.data);
            // Counted only for plans that are actually carried over.
            sessionsWithUnknownStatus += unknownStatus;
            sessionsWithUnknownKind += unknownKind;
        } else {
            rejected.push({ subject, reason: parsed.error.issues[0]?.path.join(".") || "shape" });
        }
    }

    return { profile, plans, rejected, sessionIdsRepaired, sessionsWithUnknownStatus, sessionsWithUnknownKind };
}

export type MigrationOutcome =
    | { status: "already_set_up" }
    | { status: "nothing_to_migrate" }
    | { status: "unreadable"; reason: string }
    | { status: "choose"; candidates: { id: string; name: string; plans: number }[] }
    | { status: "migrated"; plans: number; rejected: RejectedPlan[]; sessionIdsRepaired: number; sessionsWithUnknownStatus: number; sessionsWithUnknownKind: number; otherAccounts: number };

/**
 * Runs once per device: if the new storage is empty and the old page left data, copy it.
 * Safe to call on every start. The old keys are left exactly as they were.
 */
export async function migrateFromLegacy(repository: Repository, storage: ReadableStorage, chosenUserId?: string): Promise<MigrationOutcome> {
    if (await repository.isSetUp()) return { status: "already_set_up" };

    let read = readLegacy(storage);

    if (read.status === "choose" && chosenUserId) {
        const list = parseJson(storage.getItem(LEGACY_USERS_KEY));
        const user = list.ok && Array.isArray(list.value) ? list.value.filter(isRecord).find((u) => u.id === chosenUserId) : undefined;
        if (user) read = { status: "found", user, otherAccounts: read.candidates.length - 1 };
    }

    if (read.status === "none") return { status: "nothing_to_migrate" };
    if (read.status !== "found") return read;

    const converted = convertLegacyUser(read.user);
    try {
        await repository.initialise(converted.profile, converted.plans, { fromLegacy: true });
    } catch (error) {
        // Another tab of the app finished the same copy first. Its data is there; ours is not needed.
        if (error instanceof AlreadySetUpError) return { status: "already_set_up" };
        throw error;
    }

    return {
        status: "migrated",
        plans: converted.plans.length,
        rejected: converted.rejected,
        sessionIdsRepaired: converted.sessionIdsRepaired,
        sessionsWithUnknownStatus: converted.sessionsWithUnknownStatus,
        sessionsWithUnknownKind: converted.sessionsWithUnknownKind,
        otherAccounts: read.otherAccounts,
    };
}
