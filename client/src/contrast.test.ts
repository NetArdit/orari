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

/* Boundaries of controls (inputs, buttons) and the focus colour must reach 3:1 against every surface they sit on
   (WCAG 1.4.11). The decorative `line` token is not used for a control's edge. */
const NON_TEXT: Array<[string, string]> = ["page", "surface", "raised", "sunk"].flatMap(
    (bg) => [["control", bg], ["accent", bg], ["ok", bg], ["bad", bg]] as Array<[string, string]>,
);
/* The outline of a pressed chip (accent or ok) sits between the surface and its own wash; the invalid-field edge
   (bad) sits on the raised input fill. Each must stand out from the wash it encloses as well. */
NON_TEXT.push(["accent", "accent-wash"], ["ok", "ok-wash"], ["bad", "bad-wash"]);

describe.each(PALETTES)("non-text contrast, %s", (_name, selector) => {
    const tokens = palette(selector);
    it.each(NON_TEXT)("%s against %s is at least 3:1", (foreground, background) => {
        expect(ratio(tokens[foreground]!, tokens[background]!)).toBeGreaterThanOrEqual(3);
    });
});

/* Text drawn with reduced opacity (the `opacity-80` / `opacity-90` classes) is a blend of the text colour and what is
   behind it. In the notebook style the next-session card is accent-filled and carries on-accent text; in the blocks
   style it is a raised card with ordinary text. Both must still read at 4.5:1. */
const blend = (fg: string, bg: string, alpha: number) => {
    const mix = (i: number) => Math.round(parseInt(fg.slice(1 + i * 2, 3 + i * 2), 16) * alpha + parseInt(bg.slice(1 + i * 2, 3 + i * 2), 16) * (1 - alpha));
    return "#" + [0, 1, 2].map((i) => mix(i).toString(16).padStart(2, "0")).join("");
};
describe.each(PALETTES)("faded text, %s", (name, selector) => {
    const tokens = palette(selector);
    const [fg, bg] = name.startsWith("notebook") ? ["on-accent", "accent"] : ["text", "raised"];
    it.each([0.8, 0.9])(`${fg} at %s opacity on ${bg} is at least 4.5:1`, (alpha) => {
        expect(ratio(blend(tokens[fg!]!, tokens[bg!]!, alpha), tokens[bg!]!)).toBeGreaterThanOrEqual(4.5);
    });
});

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
