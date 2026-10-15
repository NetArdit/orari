/* Applies the saved look before the first paint, so there is no flash of the wrong look.
   Loaded as an ordinary script in <head> (the security policy allows scripts from this origin only).
   Same rules as client/src/settings/appearance.ts; a test runs this file against that module:
   dark mode is the blocks layout in dark colours, light mode is the notebook layout in light colours. */
(function () {
    var dark = false;
    try {
        var saved = JSON.parse(window.localStorage.getItem("orari.appearance") || "null");
        dark = !!saved && saved.colorMode === "dark";
    } catch (e) {
        /* storage blocked or damaged: light mode */
    }
    var root = document.documentElement;
    root.dataset.style = dark ? "blocks" : "notebook";
    root.dataset.theme = dark ? "dark" : "light";
})();
