import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* WCAG 2.x contrast of the colour tokens in styles.css, for both styles in light and dark.
   System mode resolves to one of these two, so four palettes cover all six combinations. */

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function palette(selector: string): Record<string, string> {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`no block for ${selector}`);
    const body = css.slice(start, css.indexOf("}", start));
    const tokens: Record<string, string> = {};
    for (const match of body.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) tokens[match[1]!] = match[2]!;
    return tokens;
}

function luminance(hex: string): number {
    const channel = (i: number) => {
        const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function ratio(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
}

const PALETTES: Array<[string, string]> = [
    ["notebook light", '[data-style="notebook"][data-theme="light"]'],
    ["notebook dark", '[data-style="notebook"][data-theme="dark"]'],
    ["blocks light", '[data-style="blocks"][data-theme="light"]'],
    ["blocks dark", '[data-style="blocks"][data-theme="dark"]'],
];

/* Text on the surface it is drawn on. Body-size text needs 4.5. */
const PAIRS: Array<[string, string]> = [
    ["text", "page"], ["text", "surface"], ["text", "raised"], ["text", "sunk"],
    ["muted", "page"], ["muted", "surface"], ["muted", "raised"], ["muted", "sunk"],
    ["accent", "page"], ["accent", "raised"], ["accent", "accent-wash"],
    ["on-accent", "accent"],
    ["ok", "ok-wash"], ["warn", "warn-wash"], ["bad", "bad-wash"],
    ["t-learn", "raised"], ["t-practice", "raised"], ["t-recall", "raised"], ["t-review", "raised"], ["t-test", "raised"],
];

describe.each(PALETTES)("contrast, %s", (_name, selector) => {
    const tokens = palette(selector);
    it.each(PAIRS)("%s on %s is at least 4.5:1", (foreground, background) => {
        const fg = tokens[foreground];
        const bg = tokens[background];
        expect(fg, `${foreground} missing`).toBeDefined();
        expect(bg, `${background} missing`).toBeDefined();
        expect(ratio(fg!, bg!)).toBeGreaterThanOrEqual(4.5);
    });
});
