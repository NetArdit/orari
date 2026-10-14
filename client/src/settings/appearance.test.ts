import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { APPEARANCE_CACHE_KEY, applyAppearance, COLOR_MODES, DEFAULT_APPEARANCE, LAYOUT_STYLES, parseAppearance, readCachedAppearance, resolveTheme, writeCachedAppearance } from "./appearance.ts";

describe("the stored values", () => {
    test("two styles and three modes, with these exact stored names", () => {
        expect([...LAYOUT_STYLES]).toEqual(["notebook", "blocks"]);
        expect([...COLOR_MODES]).toEqual(["system", "light", "dark"]);
        expect(DEFAULT_APPEARANCE).toEqual({ layoutStyle: "notebook", colorMode: "system" });
    });

    test("anything is read as something usable; each field falls back on its own", () => {
        expect(parseAppearance({ layoutStyle: "blocks", colorMode: "dark" })).toEqual({ layoutStyle: "blocks", colorMode: "dark" });
        expect(parseAppearance({ layoutStyle: "blocks", colorMode: "purple" })).toEqual({ layoutStyle: "blocks", colorMode: "system" });
        expect(parseAppearance({ layoutStyle: 5, colorMode: "light" })).toEqual({ layoutStyle: "notebook", colorMode: "light" });
        for (const junk of [null, undefined, "dark", 7, [], {}, { layoutStyle: {}, colorMode: [] }]) {
            expect(parseAppearance(junk)).toEqual(DEFAULT_APPEARANCE);
        }
    });

    test("labels are not stored values: a stored label is not accepted", () => {
        expect(parseAppearance({ layoutStyle: "Fletore", colorMode: "E errët" })).toEqual(DEFAULT_APPEARANCE);
    });
});

describe("system mode follows the device", () => {
    test("light and dark are fixed; system takes the device's preference", () => {
        expect(resolveTheme("light", true)).toBe("light");
        expect(resolveTheme("dark", false)).toBe("dark");
        expect(resolveTheme("system", true)).toBe("dark");
        expect(resolveTheme("system", false)).toBe("light");
    });
});

describe("the device's cached choice", () => {
    const memory = (initial?: string) => {
        const items = new Map<string, string>(initial === undefined ? [] : [[APPEARANCE_CACHE_KEY, initial]]);
        return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), items };
    };

    test("what is written is read back", () => {
        const storage = memory();
        writeCachedAppearance(storage, { layoutStyle: "blocks", colorMode: "dark" });
        expect(readCachedAppearance(storage)).toEqual({ layoutStyle: "blocks", colorMode: "dark" });
    });

    test("nothing cached, damaged JSON, or storage that throws: the defaults, and no exception", () => {
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
        expect(applyAppearance(root, { layoutStyle: "blocks", colorMode: "system" }, true)).toBe("dark");
        expect(root.dataset).toEqual({ style: "blocks", theme: "dark" });
        applyAppearance(root, { layoutStyle: "notebook", colorMode: "light" }, true);
        expect(root.dataset).toEqual({ style: "notebook", theme: "light" });
    });
});

describe("public/theme-init.js, the pre-paint copy of these rules", () => {
    const source = readFileSync(path.join(import.meta.dirname, "..", "..", "public", "theme-init.js"), "utf8");

    function run(cached: string | null, prefersDark: boolean, storageThrows = false) {
        const dataset: Record<string, string> = {};
        const window = {
            localStorage: { getItem: () => (storageThrows ? (() => { throw new Error("blocked"); })() : cached) },
            matchMedia: () => ({ matches: prefersDark }),
        };
        runInNewContext(source, { window, document: { documentElement: { dataset } }, JSON });
        return dataset;
    }

    test("gives the same answer as the module for every stored combination and device preference", () => {
        for (const layoutStyle of LAYOUT_STYLES) {
            for (const colorMode of COLOR_MODES) {
                for (const prefersDark of [false, true]) {
                    const expected = { style: layoutStyle, theme: resolveTheme(colorMode, prefersDark) };
                    expect(run(JSON.stringify({ layoutStyle, colorMode }), prefersDark)).toEqual(expected);
                }
            }
        }
    });

    test("gives the same answer for missing, damaged and partly wrong data", () => {
        const cases: (string | null)[] = [null, "{bad", "null", "[]", JSON.stringify({ layoutStyle: "blocks" }), JSON.stringify({ colorMode: "dark" }), JSON.stringify({ layoutStyle: "x", colorMode: "y" })];
        for (const cached of cases) {
            for (const prefersDark of [false, true]) {
                let value: unknown = null;
                try {
                    value = cached === null ? null : JSON.parse(cached);
                } catch {
                    value = null;
                }
                const a = parseAppearance(value);
                expect(run(cached, prefersDark)).toEqual({ style: a.layoutStyle, theme: resolveTheme(a.colorMode, prefersDark) });
            }
        }
    });

    test("blocked storage gives the defaults", () => {
        expect(run(null, false, true)).toEqual({ style: "notebook", theme: "light" });
        expect(run(null, true, true)).toEqual({ style: "notebook", theme: "dark" });
    });
});
