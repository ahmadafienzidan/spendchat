import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

export function migrate(db: Database.Database, dir: string): string[] {
	db.exec(
		"CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
	);
	const applied = new Set(
		db
			.prepare<[], { name: string }>("SELECT name FROM schema_migrations")
			.all()
			.map((row) => row.name),
	);
	const pending = readdirSync(dir)
		.filter((name) => name.endsWith(".sql") && !applied.has(name))
		.sort();
	const record = db.prepare<[string, string]>(
		"INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
	);
	for (const name of pending) {
		db.transaction(() => {
			db.exec(readFileSync(join(dir, name), "utf8"));
			record.run(name, new Date().toISOString());
		})();
	}
	return pending;
}
