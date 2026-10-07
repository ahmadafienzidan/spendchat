import { copyFileSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/migrate";

function appliedNames(db: Database.Database): string[] {
	return db
		.prepare<[], { name: string }>(
			"SELECT name FROM schema_migrations ORDER BY name",
		)
		.all()
		.map((row) => row.name);
}

function copyOfMigrations(): string {
	const dir = mkdtempSync(join(tmpdir(), "spendchat-migrations-"));
	for (const file of readdirSync("migrations"))
		copyFileSync(join("migrations", file), join(dir, file));
	return dir;
}

describe("migrate", () => {
	it("applies every migration once and records it", () => {
		const db = new Database(":memory:");
		expect(migrate(db, "migrations")).toEqual([
			"0001_init.sql",
			"0002_seed_keywords.sql",
		]);
		expect(migrate(db, "migrations")).toEqual([]);
		expect(appliedNames(db)).toEqual([
			"0001_init.sql",
			"0002_seed_keywords.sql",
		]);
	});

	it("creates the tables and seeds keywords", () => {
		const db = new Database(":memory:");
		migrate(db, "migrations");
		const row = db
			.prepare<[string], { category: string }>(
				"SELECT category FROM category_keywords WHERE keyword = ?",
			)
			.get("bensin");
		expect(row?.category).toBe("Transport");
		const [count] = db
			.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM expenses")
			.all();
		expect(count.n).toBe(0);
	});

	it("applies only a newly added file", () => {
		const dir = copyOfMigrations();
		const db = new Database(":memory:");
		migrate(db, dir);
		writeFileSync(
			join(dir, "0003_extra.sql"),
			"CREATE TABLE extra (id INTEGER PRIMARY KEY);",
		);
		expect(migrate(db, dir)).toEqual(["0003_extra.sql"]);
	});

	it("rolls back and does not record a failing migration", () => {
		const dir = copyOfMigrations();
		const db = new Database(":memory:");
		migrate(db, dir);
		writeFileSync(
			join(dir, "0003_bad.sql"),
			"CREATE TABLE half (id INTEGER); CREATE TABLE expenses (id INTEGER);",
		);
		expect(() => migrate(db, dir)).toThrow();
		expect(appliedNames(db)).not.toContain("0003_bad.sql");
		expect(
			db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get(),
		).toBeUndefined();
	});
});
