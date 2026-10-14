import { afterEach, describe, expect, test, vi } from "vitest";
import { uuid } from "./ids.ts";

describe("uuid", () => {
    afterEach(() => vi.unstubAllGlobals());

    test("uses the platform's own when it has one", () => {
        expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    test("falls back to getRandomValues, still a version 4 UUID, and never repeats", () => {
        const real = globalThis.crypto;
        vi.stubGlobal("crypto", { getRandomValues: <T extends ArrayBufferView>(array: T): T => real.getRandomValues(array as never) as T });
        const ids = new Set(Array.from({ length: 200 }, () => uuid()));
        expect(ids.size).toBe(200);
        for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
});
