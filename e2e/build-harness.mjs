/**
 * Builds the client with the storage test harness page included (client/e2e-harness.html), for
 * e2e/app-two-tabs.mjs. Run a normal `npm run client:build` afterwards to get a build without it.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

process.env.E2E = "1";
await build({ root: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client") });
