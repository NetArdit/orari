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
        proxy: { "/api": "http://localhost:3000" },
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
    },
    test: {
        // Logic is tested without a DOM; behaviour in a real browser is covered by the journeys in e2e/.
        environment: "node",
        include: ["src/**/*.test.ts"],
    },
});
