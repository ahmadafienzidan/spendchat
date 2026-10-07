import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { openDatabase } from "./database";
import app from "./index";

const config = loadConfig(process.env);

const { db, applied } = openDatabase(config.databasePath);
if (applied.length > 0)
	console.log(`Applied migrations: ${applied.join(", ")}`);

const env = { ...config.bindings, DB: db };
serve({
	fetch: (request) => app.fetch(request, env),
	hostname: "127.0.0.1",
	port: config.port,
});
console.log(`SpendChat listening on 127.0.0.1:${config.port}`);
