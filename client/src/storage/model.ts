/**
 * What the client keeps on the device, and the checks that anything read back (from the device's own
 * database, from the old page's data, from a backup file) must pass before the app uses it.
 * Stored data is input like any other: it can be old, half-written or edited by hand.
 */
import { z } from "zod";

/** Raised whenever the stored shape changes; old data is upgraded in repository.ts. */
export const SCHEMA_VERSION = 1;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const SESSION_STATUSES = ["pending", "completed", "partial", "skipped"] as const;
export const SESSION_KINDS = ["learning", "practice", "recall", "revision", "assessment", "project"] as const;

export const StoredSession = z.object({
    id: z.string().min(1),
    status: z.enum(SESSION_STATUSES).catch("pending"),
    date: dateStr,
    startTime: timeStr,
    endTime: timeStr,
    type: z.enum(SESSION_KINDS).catch("learning"),
    title: z.string().min(1).max(200),
    goal: z.string().max(400).catch(""),
    tasks: z.array(z.string().max(300)).max(12).catch([]),
    material: z.string().max(300).nullable().catch(null),
    difficulty: z.enum(["easy", "medium", "hard"]).catch("medium"),
});

export const StoredPlan = z.object({
    id: z.string().min(1),
    createdAt: z.string().min(1),
    subject: z.string().min(1).max(200),
    startDate: dateStr,
    endDate: dateStr,
    planMode: z.string().max(40).catch("general"),
    strategy: z.string().max(2000).catch(""),
    explanations: z.array(z.string().max(600)).max(10).catch([]),
    warnings: z.array(z.string().max(600)).max(10).catch([]),
    /** The inputs the plan was made from; sent back to the server when the plan is adjusted. Kept as given. */
    structured: z.record(z.unknown()),
    sessions: z.array(StoredSession).max(2000),
});

/** A local profile. No password and no e-mail: there is no account, the data lives on this device. */
export const StoredProfile = z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(80),
    educationLevel: z.string().max(40).nullable().catch(null),
    school: z.string().max(120).catch(""),
    createdAt: z.string().min(1),
});

export const StoredMeta = z.object({
    schemaVersion: z.number().int().min(1),
    createdAt: z.string(),
    /** Set when the profile and plans were copied from the old page's data. */
    migratedFromLegacyAt: z.string().nullable(),
});

export const BackupFile = z.object({
    format: z.literal("planifikues-kopje"),
    schemaVersion: z.number().int().min(1),
    exportedAt: z.string(),
    profile: StoredProfile,
    plans: z.array(z.unknown()).max(500),
});

export type StoredSession = z.output<typeof StoredSession>;
export type StoredPlan = z.output<typeof StoredPlan>;
export type StoredProfile = z.output<typeof StoredProfile>;
export type StoredMeta = z.output<typeof StoredMeta>;
export type BackupFile = z.output<typeof BackupFile>;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
