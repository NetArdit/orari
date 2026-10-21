// Puts the pages where the host publishes them: the built client under /app (its files refer to /app/...), and the
// small page of the old address, which only redirects to /app/.
import { cpSync, mkdirSync, rmSync, copyFileSync } from "node:fs";

rmSync("netlify-dist", { recursive: true, force: true });
mkdirSync("netlify-dist", { recursive: true });
cpSync("client/dist", "netlify-dist/app", { recursive: true });
copyFileSync("public/index.html", "netlify-dist/index.html");
console.log("netlify-dist ready");
