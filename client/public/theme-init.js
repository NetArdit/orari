/* Applies the saved look before the first paint, so there is no flash of the wrong style or mode.
   Loaded as an ordinary script in <head> (the security policy allows scripts from this origin only).
   Same rules as client/src/settings/appearance.ts; a test runs this file against that module. */
(function () {
    var styles = ["notebook", "blocks"];
    var modes = ["system", "light", "dark"];
    var style = "notebook";
    var mode = "system";
    try {
        var saved = JSON.parse(window.localStorage.getItem("orari.appearance") || "null");
        if (saved && styles.indexOf(saved.layoutStyle) !== -1) style = saved.layoutStyle;
        if (saved && modes.indexOf(saved.colorMode) !== -1) mode = saved.colorMode;
    } catch (e) {
        /* storage blocked or damaged: the defaults */
    }
    var dark = false;
    try {
        dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (e) {
        /* no matchMedia: light */
    }
    var root = document.documentElement;
    root.dataset.style = style;
    root.dataset.theme = mode === "system" ? (dark ? "dark" : "light") : mode;
})();
