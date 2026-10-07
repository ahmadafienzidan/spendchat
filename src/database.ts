import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { migrate } from "./migrate";

// Resolves to <repo>/migrations from src/, scripts/ (via tsx) and dist/ (built).
const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

export function openDatabase(path: string): {
	db: Database.Database;
	applied: string[];
} {
	const db = new Database(path);
	db.pragma("journal_mode = WAL");
	db.pragma("busy_timeout = 5000");
	return { db, applied: migrate(db, MIGRATIONS_DIR) };
}
