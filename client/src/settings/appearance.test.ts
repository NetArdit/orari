import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { APPEARANCE_CACHE_KEY, applyAppearance, COLOR_MODES, DEFAULT_APPEARANCE, LOOKS, parseAppearance, readCachedAppearance, resolveTheme, writeCachedAppearance } from "./appearance.ts";

describe("the two looks", () => {
    test("light mode is the notebook layout in light colours; dark mode is the blocks layout in dark colours", () => {
        expect([...COLOR_MODES]).toEqual(["light", "dark"]);
        expect(LOOKS.light).toEqual({ layoutStyle: "notebook", colorMode: "light" });
        expect(LOOKS.dark).toEqual({ layoutStyle: "blocks", colorMode: "dark" });
        expect(DEFAULT_APPEARANCE).toEqual(LOOKS.light);
    });

    test("anything is read as one of the two looks; only an explicit dark gives dark", () => {
        expect(parseAppearance({ layoutStyle: "blocks", colorMode: "dark" })).toEqual(LOOKS.dark);
        expect(parseAppearance({ layoutStyle: "notebook", colorMode: "dark" })).toEqual(LOOKS.dark);
        expect(parseAppearance({ layoutStyle: "blocks", colorMode: "light" })).toEqual(LOOKS.light);
        // an older stored choice ("system") and plain junk are light mode
        expect(parseAppearance({ layoutStyle: "blocks", colorMode: "system" })).toEqual(LOOKS.light);
        for (const junk of [null, undefined, "dark", 7, [], {}, { layoutStyle: {}, colorMode: [] }]) {
            expect(parseAppearance(junk)).toEqual(LOOKS.light);
        }
    });

    test("the theme is the colour mode, whatever the device prefers", () => {
        expect(resolveTheme("light", true)).toBe("light");
        expect(resolveTheme("dark", false)).toBe("dark");
    });
});

describe("the device's cached choice", () => {
    const memory = (initial?: string) => {
        const items = new Map<string, string>(initial === undefined ? [] : [[APPEARANCE_CACHE_KEY, initial]]);
        return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), items };
    };

    test("what is written is read back", () => {
        const storage = memory();
        writeCachedAppearance(storage, LOOKS.dark);
        expect(readCachedAppearance(storage)).toEqual(LOOKS.dark);
    });

    test("nothing cached, damaged JSON, or storage that throws: light mode, and no exception", () => {
        expect(readCachedAppearance(memory())).toEqual(DEFAULT_APPEARANCE);
        expect(readCachedAppearance(memory("{not json"))).toEqual(DEFAULT_APPEARANCE);
        expect(readCachedAppearance(null)).toEqual(DEFAULT_APPEARANCE);
        const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
        expect(readCachedAppearance(blocked)).toEqual(DEFAULT_APPEARANCE);
        expect(() => writeCachedAppearance(blocked, DEFAULT_APPEARANCE)).not.toThrow();
    });

    test("the returned defaults are a copy that cannot change the shared default", () => {
        readCachedAppearance(null).layoutStyle = "blocks";
        expect(DEFAULT_APPEARANCE.layoutStyle).toBe("notebook");
    });
});

describe("applying to the page", () => {
    test("sets the two attributes the stylesheet reads", () => {
        const root = { dataset: {} as Record<string, string | undefined> };
        expect(applyAppearance(root, LOOKS.dark, false)).toBe("dark");
        expect(root.dataset).toEqual({ style: "blocks", theme: "dark" });
        applyAppearance(root, LOOKS.light, true);
        expect(root.dataset).toEqual({ style: "notebook", theme: "light" });
    });
});

describe("public/theme-init.js, the pre-paint copy of these rules", () => {
    const source = readFileSync(path.join(import.meta.dirname, "..", "..", "public", "theme-init.js"), "utf8");

    function run(cached: string | null, storageThrows = false) {
        const dataset: Record<string, string> = {};
        const window = { localStorage: { getItem: () => (storageThrows ? (() => { throw new Error("blocked"); })() : cached) } };
        runInNewContext(source, { window, document: { documentElement: { dataset } }, JSON });
        return dataset;
    }

    test("gives the same answer as the module for every stored combination", () => {
        for (const layoutStyle of ["notebook", "blocks"]) {
            for (const colorMode of ["light", "dark", "system"]) {
                const a = parseAppearance({ layoutStyle, colorMode });
                expect(run(JSON.stringify({ layoutStyle, colorMode }))).toEqual({ style: a.layoutStyle, theme: a.colorMode });
            }
        }
    });

    test("gives the same answer for missing, damaged and partly wrong data", () => {
        const cases: (string | null)[] = [null, "{bad", "null", "[]", JSON.stringify({ layoutStyle: "blocks" }), JSON.stringify({ colorMode: "dark" }), JSON.stringify({ layoutStyle: "x", colorMode: "y" })];
        for (const cached of cases) {
            let value: unknown = null;
            try {
                value = cached === null ? null : JSON.parse(cached);
            } catch {
                value = null;
            }
            const a = parseAppearance(value);
            expect(run(cached)).toEqual({ style: a.layoutStyle, theme: a.colorMode });
        }
    });

    test("blocked storage gives light mode", () => {
        expect(run(null, true)).toEqual({ style: "notebook", theme: "light" });
    });
});
