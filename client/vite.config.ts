import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The new client lives beside the old page: Express serves the build at /app
// and keeps the old page at /. In development Vite serves it and passes
// /api to the Express server on port 3000.
export default defineConfig({
    base: "/app/",
    plugins: [react(), tailwindcss()],
    server: {
        // The server refuses state-changing requests whose Origin is not its own. The browser's Origin is the
        // Vite address, so in development the proxy presents the server's own origin (development only).
        proxy: { "/api": { target: "http://localhost:3000", changeOrigin: true, headers: { origin: "http://localhost:3000" } } },
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        // E2E=1 adds a second page that exposes the storage layer to the two-tab browser journey.
        // A normal build has only index.html.
        rollupOptions: {
            input: {
                index: path.resolve(import.meta.dirname, "index.html"),
                ...(process.env.E2E === "1" ? { "e2e-harness": path.resolve(import.meta.dirname, "e2e-harness.html") } : {}),
            },
        },
    },
    test: {
        // Logic is tested without a DOM; behaviour in a real browser is covered by the journeys in e2e/.
        environment: "node",
        include: ["src/**/*.test.ts"],
    },
});
