import { BackupFile, SCHEMA_VERSION, StoredMeta, StoredPlan, StoredProfile } from "./model.ts";
import type { SessionStatus } from "./model.ts";
import { PreconditionFailedError } from "./store.ts";
import type { KeyValueStore, Write } from "./store.ts";

const META = "meta";
const PROFILE = "profile";
const PLAN = "plan:";

export class StorageTooNewError extends Error {
    constructor(public readonly found: number) {
        super("storage_newer_than_app");
    }
}

/** A plan in storage that no longer passes the checks. It is reported and left where it is, never deleted. */
export interface UnreadablePlan {
    key: string;
    reason: string;
}

/** Thrown by initialise when this device already has a profile, including one written by another tab a moment ago. */
export class AlreadySetUpError extends Error {
    constructor() {
        super("already_set_up");
    }
}

export interface ImportSummary {
    plansImported: number;
    /** Plans in the file that failed the checks. */
    plansRejected: number;
    /** Plans in the file whose id had already appeared in it; the first one was kept. */
    plansDuplicated: number;
}

/**
 * Everything the app reads and writes on the device goes through here.
 * Rules: what is read is validated; a write either happens completely or not at all;
 * nothing is deleted except by an explicit delete or a confirmed restore.
 */
export function createRepository(store: KeyValueStore, now: () => Date = () => new Date()) {
    async function readMeta(): Promise<StoredMeta | null> {
        const raw = await store.get(META);
        if (raw === undefined) return null;
        const meta = StoredMeta.parse(raw);
        // Data written by a newer version of the app must not be reinterpreted by an older one.
        if (meta.schemaVersion > SCHEMA_VERSION) throw new StorageTooNewError(meta.schemaVersion);
        return meta;
    }

    const newMeta = (migratedFromLegacyAt: string | null): StoredMeta => ({ schemaVersion: SCHEMA_VERSION, createdAt: now().toISOString(), migratedFromLegacyAt });

    const planWrites = (plans: StoredPlan[]): Write[] => plans.map((plan) => ({ key: PLAN + plan.id, value: plan }));

    return {
        readMeta,

        /** True once a profile exists on this device. */
        async isSetUp(): Promise<boolean> {
            return (await readMeta()) !== null && (await store.get(PROFILE)) !== undefined;
        },

        async getProfile(): Promise<StoredProfile | null> {
            const raw = await store.get(PROFILE);
            return raw === undefined ? null : StoredProfile.parse(raw);
        },

        /**
         * First set-up of this device: profile and any plans, in one write. Refuses if a profile already
         * exists. The "does one exist" check is part of the write itself, so two tabs starting at the same
         * moment cannot both succeed: the second gets AlreadySetUpError and nothing of its data is stored.
         */
        async initialise(profile: StoredProfile, plans: StoredPlan[], options: { fromLegacy: boolean }): Promise<void> {
            const validated = plans.map((p) => StoredPlan.parse(p));
            if (new Set(validated.map((p) => p.id)).size !== validated.length) throw new Error("duplicate_plan_ids");
            try {
                await store.commit(
                    [
                        { key: META, value: newMeta(options.fromLegacy ? now().toISOString() : null) },
                        { key: PROFILE, value: StoredProfile.parse(profile) },
                        ...planWrites(validated),
                    ],
                    { onlyIfAbsent: [PROFILE] }
                );
            } catch (error) {
                if (error instanceof PreconditionFailedError) throw new AlreadySetUpError();
                throw error;
            }
        },

        async saveProfile(profile: StoredProfile): Promise<void> {
            await store.commit([{ key: PROFILE, value: StoredProfile.parse(profile) }]);
        },

        /** Newest first. Plans that fail the checks are returned separately and stay in storage. */
        async listPlans(): Promise<{ plans: StoredPlan[]; unreadable: UnreadablePlan[] }> {
            const plans: StoredPlan[] = [];
            const unreadable: UnreadablePlan[] = [];
            for (const key of await store.keys(PLAN)) {
                const parsed = StoredPlan.safeParse(await store.get(key));
                if (parsed.success) plans.push(parsed.data);
                else unreadable.push({ key, reason: parsed.error.issues[0]?.path.join(".") || "shape" });
            }
            plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            return { plans, unreadable };
        },

        async getPlan(id: string): Promise<StoredPlan | null> {
            const parsed = StoredPlan.safeParse(await store.get(PLAN + id));
            return parsed.success ? parsed.data : null;
        },

        async savePlan(plan: StoredPlan): Promise<void> {
            await store.commit([{ key: PLAN + plan.id, value: StoredPlan.parse(plan) }]);
        },

        async deletePlan(id: string): Promise<void> {
            await store.commit([{ key: PLAN + id, delete: true }]);
        },

        /** Marks one session. Returns the updated plan, or null if the plan or the session is not there. */
        async setSessionStatus(planId: string, sessionId: string, status: SessionStatus): Promise<StoredPlan | null> {
            const plan = await this.getPlan(planId);
            const session = plan?.sessions.find((s) => s.id === sessionId);
            if (!plan || !session) return null;
            session.status = status;
            await this.savePlan(plan);
            return plan;
        },

        /** Everything on the device as one object, to be saved as a file by the person. */
        async exportBackup(): Promise<BackupFile> {
            const profile = await this.getProfile();
            if (!profile) throw new Error("nothing_to_export");
            const { plans } = await this.listPlans();
            return { format: "planifikues-kopje", schemaVersion: SCHEMA_VERSION, exportedAt: now().toISOString(), profile, plans };
        },

        /**
         * Replaces what is on the device with a backup. The file is checked completely before anything is
         * touched; plans in it that fail the checks, or repeat an id already seen in the file, are skipped
         * and counted, never merged into one another. Which plans to remove is decided inside the write,
         * from what is in storage at that moment, so a plan saved by another tab just before the restore
         * is removed with the rest instead of surviving it by accident.
         */
        async restoreBackup(file: unknown): Promise<ImportSummary> {
            const backup = BackupFile.parse(file);
            if (backup.schemaVersion > SCHEMA_VERSION) throw new StorageTooNewError(backup.schemaVersion);

            const plans: StoredPlan[] = [];
            const ids = new Set<string>();
            let rejected = 0;
            let duplicated = 0;
            for (const raw of backup.plans) {
                const parsed = StoredPlan.safeParse(raw);
                if (!parsed.success) rejected++;
                else if (ids.has(parsed.data.id)) duplicated++;
                else {
                    ids.add(parsed.data.id);
                    plans.push(parsed.data);
                }
            }

            const existing = await readMeta();
            await store.commit([
                { key: META, value: existing ?? newMeta(null) },
                { key: PROFILE, value: backup.profile },
                { deletePrefix: PLAN, except: plans.map((p) => PLAN + p.id) },
                ...planWrites(plans),
            ]);
            return { plansImported: plans.length, plansRejected: rejected, plansDuplicated: duplicated };
        },
    };
}

export type Repository = ReturnType<typeof createRepository>;
