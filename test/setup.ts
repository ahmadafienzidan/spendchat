import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Migration 0002 holds the seed keywords; re-running its inserts restores them.
const seedQueries = env.TEST_MIGRATIONS[1].queries;

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare("DELETE FROM expenses"),
		env.DB.prepare("DELETE FROM category_keywords"),
		env.DB.prepare("DELETE FROM login_tokens"),
		env.DB.prepare("DELETE FROM processed_messages"),
		...seedQueries.map((query) => env.DB.prepare(query)),
	]);
});
