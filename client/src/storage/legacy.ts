/**
 * Copying a person's data from the old page (localStorage keys studyflow_users and
 * studyflow_current_user) into the new storage.
 *
 * What is carried over: name, education level, school, and every plan with its sessions and their status.
 * What is not: the password and the e-mail address. There is no account any more; the data stays on
 * this device. The old keys are only read here, never changed or removed; that happens at cutover.
 */
import { StoredPlan, StoredProfile } from "./model.ts";
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
    const planIds = new Set<string>();

    for (const raw of Array.isArray(user.plans) ? user.plans : []) {
        const subject = isRecord(raw) ? text(raw.subject, 200) : "";
        if (!isRecord(raw)) {
            rejected.push({ subject, reason: "not_an_object" });
            continue;
        }

        // The old server numbered sessions from 1 on every adjustment, so one plan can hold the same id twice.
        // Ticking one of them would change the other; later duplicates get a fresh id.
        const seen = new Set<string>();
        const sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).filter(isRecord).map((session) => {
            let id = text(session.id, 100);
            if (!id || seen.has(id)) {
                id = newId();
                sessionIdsRepaired++;
            }
            seen.add(id);
            return { ...session, id };
        });

        let id = text(raw.id, 100);
        if (!id || planIds.has(id)) id = newId();

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
        } else {
            rejected.push({ subject, reason: parsed.error.issues[0]?.path.join(".") || "shape" });
        }
    }

    return { profile, plans, rejected, sessionIdsRepaired };
}

export type MigrationOutcome =
    | { status: "already_set_up" }
    | { status: "nothing_to_migrate" }
    | { status: "unreadable"; reason: string }
    | { status: "choose"; candidates: { id: string; name: string; plans: number }[] }
    | { status: "migrated"; plans: number; rejected: RejectedPlan[]; sessionIdsRepaired: number; otherAccounts: number };

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
    await repository.initialise(converted.profile, converted.plans, { fromLegacy: true });

    return {
        status: "migrated",
        plans: converted.plans.length,
        rejected: converted.rejected,
        sessionIdsRepaired: converted.sessionIdsRepaired,
        otherAccounts: read.otherAccounts,
    };
}
