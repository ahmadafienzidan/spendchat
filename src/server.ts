import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import Database from "better-sqlite3";
import { loadConfig } from "./config";
import app from "./index";
import { migrate } from "./migrate";

const config = loadConfig(process.env);

const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
// Resolves to <repo>/migrations from both src/server.ts (dev) and dist/server.js (built).
const applied = migrate(
	db,
	fileURLToPath(new URL("../migrations", import.meta.url)),
);
if (applied.length > 0)
	console.log(`Applied migrations: ${applied.join(", ")}`);

const env = { ...config.bindings, DB: db };
serve({
	fetch: (request) => app.fetch(request, env),
	hostname: "127.0.0.1",
	port: config.port,
});
console.log(`SpendChat listening on 127.0.0.1:${config.port}`);
