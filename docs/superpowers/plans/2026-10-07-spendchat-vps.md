# SpendChat VPS Port Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing SpendChat app on an IDCloudHost Cloud VPS (Node.js 22 + SQLite file + Caddy + systemd) instead of Cloudflare Workers + D1, with identical chat and dashboard behavior.

**Architecture:** Hono stays; `@hono/node-server` serves it on `127.0.0.1:3000` behind Caddy (HTTPS). `db.ts` moves from async D1 calls to synchronous `better-sqlite3` calls, with multi-statement writes in `db.transaction`. A small `migrate` module applies `migrations/*.sql`; `config` validates environment variables; `server.ts` wires them together. esbuild bundles `src/server.ts` to `dist/server.js`.

**Tech Stack:** TypeScript (strict), Hono 4, `@hono/node-server`, `better-sqlite3`, esbuild, tsx, Vitest 4 (plain Node), Biome 2, pnpm 11, Node.js 22 LTS, Ubuntu 24.04, Caddy, systemd.

**Spec:** `docs/superpowers/specs/2026-10-01-spendchat-design.md` (sections 3, 4, 5, 11, 12, 13 describe the VPS setup).

**Starting point:** commit `f835def` (Cloudflare version, 124 passing tests).

## Global Constraints

- Everything in the Global Constraints of `docs/superpowers/plans/2026-10-01-spendchat.md` still applies (pnpm + Biome only, English code, Indonesian user-facing text, no defensive try/catch, WIB, Conventional Commits with scope, no AI attribution, commit only when the user authorizes, push after every commit).
- Behavior must not change: the existing test assertions stay as they are. Only how tests obtain `env` and the D1-specific `migrations.test.ts` change.
- Every environment variable is required; no default values in code.
- Commands on the VPS run only after the user approves starting the server setup in chat. Never read, print, or type the user's Meta tokens or personal number; the user enters them into `/etc/spendchat.env` themselves.
- Before marking a task done: `pnpm test`, `pnpm typecheck`, `pnpm lint` all pass. Paste real output.

## File Structure (changes only)

```
spendchat/
├─ package.json            scripts dev/build/start; deps swapped; packageManager pinned
├─ pnpm-workspace.yaml     allowBuilds: esbuild, better-sqlite3
├─ tsconfig.json           Node types
├─ vitest.config.ts        plain Vitest
├─ .gitignore              + dist, .env, .data; − .wrangler, .dev.vars
├─ .env.example            replaces .dev.vars.example
├─ wrangler.jsonc          deleted
├─ src/
│  ├─ env.ts               DB: better-sqlite3 Database
│  ├─ migrate.ts           new
│  ├─ config.ts            new
│  ├─ server.ts            new entry point
│  ├─ db.ts                rewritten, synchronous
│  ├─ bot.ts               synchronous handleMessage
│  └─ routes/*.tsx|ts      drop awaits on db calls
├─ test/
│  ├─ env.d.ts             deleted
│  ├─ migrations.test.ts   deleted (moved into migrate.test.ts)
│  ├─ setup.ts             fresh in-memory env before each test
│  ├─ helpers.ts           exports env + resetEnv
│  ├─ migrate.test.ts      new
│  └─ config.test.ts       new
├─ deploy/
│  ├─ spendchat.service
│  ├─ spendchat-backup.service
│  ├─ spendchat-backup.timer
│  └─ backup.sh
└─ README.md               VPS development, setup, update, backup
```

---

### Task 1: Move the data layer and tests from D1 to better-sqlite3

**Files:**
- Modify: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `biome.json`, `.gitignore`
- Delete: `wrangler.jsonc`, `.dev.vars.example`, `test/env.d.ts`, `test/migrations.test.ts`
- Create: `src/migrate.ts`, `test/migrate.test.ts`
- Modify: `src/env.ts`, `src/db.ts`, `src/bot.ts`, `src/routes/webhook.ts`, `src/routes/login.tsx`, `src/routes/dashboard.tsx`, `src/routes/categories.tsx`
- Modify: `test/setup.ts`, `test/helpers.ts`, every `test/*.test.ts` that imports `env` from `cloudflare:workers`, `test/db.test.ts`

**Interfaces:**
- Produces:

```ts
// env.ts
import type Database from "better-sqlite3";
export type Bindings = { DB: Database.Database; BASE_URL: string; WA_ACCESS_TOKEN: string; WA_APP_SECRET: string; WA_VERIFY_TOKEN: string; WA_PHONE_NUMBER_ID: string; OWNER_WA_NUMBER: string; SESSION_SECRET: string };

// migrate.ts
export function migrate(db: Database.Database, dir: string): string[];   // names applied by this call

// db.ts — same names as before, now synchronous, first parameter Database.Database
// bot.ts
export function handleMessage(env: Bindings, message: IncomingMessage, now: Date): string;

// test/helpers.ts
export let env: Bindings;          // replaced before each test by resetEnv()
export function resetEnv(): void;
```

- [ ] **Step 1: Swap dependencies**

```bash
pnpm remove wrangler @cloudflare/workers-types @cloudflare/vitest-pool-workers
pnpm add @hono/node-server better-sqlite3
pnpm add -D @types/better-sqlite3 @types/node@22 esbuild tsx
```

`pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: true
  better-sqlite3: true
```

Run `pnpm install` again so better-sqlite3's install script runs. Delete `wrangler.jsonc`, `.dev.vars.example`, `test/env.d.ts`.

`package.json` scripts (keep dependencies as pnpm wrote them; add `packageManager` with the pnpm version from `pnpm --version`):

```json
{
  "packageManager": "pnpm@11.13.1",
  "scripts": {
    "dev": "tsx watch --env-file=.env src/server.ts",
    "build": "esbuild src/server.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outfile=dist/server.js",
    "start": "node dist/server.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "biome check ."
  }
}
```

(`dev` and `build` reference `src/server.ts`, which Task 2 creates.)

`tsconfig.json` compilerOptions: set `"types": ["node"]`, `"module": "preserve"`, `"esModuleInterop": true`; keep the rest.

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: { setupFiles: ["./test/setup.ts"] },
});
```

`biome.json` files.includes: `["**", "!node_modules", "!dist"]`.

`.gitignore`:

```
node_modules
dist
.env
.data
.claude
```

- [ ] **Step 2: Write the failing migrate test**

`test/migrate.test.ts`:

```ts
import { copyFileSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/migrate";

function appliedNames(db: Database.Database): string[] {
	return db
		.prepare<[], { name: string }>("SELECT name FROM schema_migrations ORDER BY name")
		.all()
		.map((row) => row.name);
}

function copyOfMigrations(): string {
	const dir = mkdtempSync(join(tmpdir(), "spendchat-migrations-"));
	for (const file of readdirSync("migrations")) copyFileSync(join("migrations", file), join(dir, file));
	return dir;
}

describe("migrate", () => {
	it("applies every migration once and records it", () => {
		const db = new Database(":memory:");
		expect(migrate(db, "migrations")).toEqual(["0001_init.sql", "0002_seed_keywords.sql"]);
		expect(migrate(db, "migrations")).toEqual([]);
		expect(appliedNames(db)).toEqual(["0001_init.sql", "0002_seed_keywords.sql"]);
	});

	it("creates the tables and seeds keywords", () => {
		const db = new Database(":memory:");
		migrate(db, "migrations");
		const row = db
			.prepare<[string], { category: string }>("SELECT category FROM category_keywords WHERE keyword = ?")
			.get("bensin");
		expect(row?.category).toBe("Transport");
		const [count] = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM expenses").all();
		expect(count.n).toBe(0);
	});

	it("applies only a newly added file", () => {
		const dir = copyOfMigrations();
		const db = new Database(":memory:");
		migrate(db, dir);
		writeFileSync(join(dir, "0003_extra.sql"), "CREATE TABLE extra (id INTEGER PRIMARY KEY);");
		expect(migrate(db, dir)).toEqual(["0003_extra.sql"]);
	});

	it("rolls back and does not record a failing migration", () => {
		const dir = copyOfMigrations();
		const db = new Database(":memory:");
		migrate(db, dir);
		writeFileSync(join(dir, "0003_bad.sql"), "CREATE TABLE half (id INTEGER); CREATE TABLE expenses (id INTEGER);");
		expect(() => migrate(db, dir)).toThrow();
		expect(appliedNames(db)).not.toContain("0003_bad.sql");
		expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined();
	});
});
```

Run: `pnpm test test/migrate.test.ts` → FAIL (cannot resolve `../src/migrate`).

- [ ] **Step 3: Implement migrate**

`src/migrate.ts`:

```ts
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
```

Delete `test/migrations.test.ts` (its assertions now live in `migrate.test.ts`).

- [ ] **Step 4: Switch the test harness to a fresh in-memory env**

`src/env.ts`:

```ts
import type Database from "better-sqlite3";

export type Bindings = {
	DB: Database.Database;
	BASE_URL: string;
	WA_ACCESS_TOKEN: string;
	WA_APP_SECRET: string;
	WA_VERIFY_TOKEN: string;
	WA_PHONE_NUMBER_ID: string;
	OWNER_WA_NUMBER: string;
	SESSION_SECRET: string;
};

export type AppEnv = { Bindings: Bindings };
```

`test/helpers.ts`: remove `import { env } from "cloudflare:workers";`, add at the top:

```ts
import Database from "better-sqlite3";
import type { Bindings } from "../src/env";
import { migrate } from "../src/migrate";

export let env: Bindings;

export function resetEnv(): void {
	const db = new Database(":memory:");
	migrate(db, "migrations");
	env = {
		DB: db,
		BASE_URL: "https://spendchat.test",
		WA_ACCESS_TOKEN: "test-access-token",
		WA_APP_SECRET: "test-app-secret",
		WA_VERIFY_TOKEN: "test-verify-token",
		WA_PHONE_NUMBER_ID: "1234567890",
		OWNER_WA_NUMBER: OWNER,
		SESSION_SECRET: "test-session-secret",
	};
}
```

(`OWNER` is already defined in the file; keep `resetEnv` below it.)

`test/setup.ts`:

```ts
import { beforeEach } from "vitest";
import { resetEnv } from "./helpers";

beforeEach(resetEnv);
```

In every test file, replace `import { env } from "cloudflare:workers";` with `env` imported from `./helpers` (merge into the existing `./helpers` import where there is one).

`test/db.test.ts` reads `env.DB` at module load, before any env exists. Replace `const db = env.DB;` with:

```ts
let db: Database.Database;

beforeEach(() => {
	db = env.DB;
});
```

(add `import type Database from "better-sqlite3";` and `beforeEach` to the vitest import). Setup-file hooks run before the file's own `beforeEach`, so `env` is fresh when this runs.

Run: `pnpm test` → db/bot/webhook/auth/dashboard/categories tests FAIL (D1 calls such as `.bind` do not exist on better-sqlite3). parser/time/money/crypto/replies/migrate tests pass.

- [ ] **Step 5: Rewrite `src/db.ts` synchronously**

```ts
import type Database from "better-sqlite3";
import { randomToken } from "./crypto";
import type { Keyword, ParsedExpense } from "./parser";
import type { DateRange } from "./time";

type DB = Database.Database;

export type Expense = {
	id: number;
	amount: number;
	description: string;
	category: string;
	spent_on: string;
};
export type CategoryTotal = { category: string; total: number };
export type DailyTotal = { spent_on: string; total: number };
export type MessageMeta = { waMessageId: string; now: Date };
export type ExpenseUpdate = {
	amount: number;
	description: string;
	category: string;
	spentOn: string;
};

const EXPENSE_COLUMNS = "id, amount, description, category, spent_on";
const LOGIN_TOKEN_TTL_MS = 10 * 60 * 1000;

function markProcessed(db: DB, meta: MessageMeta): void {
	db.prepare(
		"INSERT INTO processed_messages (wa_message_id, processed_at) VALUES (?, ?)",
	).run(meta.waMessageId, meta.now.toISOString());
}

export function isProcessed(db: DB, waMessageId: string): boolean {
	return (
		db
			.prepare("SELECT 1 FROM processed_messages WHERE wa_message_id = ?")
			.get(waMessageId) !== undefined
	);
}

export function getKeywords(db: DB): Keyword[] {
	return db
		.prepare<[], Keyword>(
			"SELECT keyword, category FROM category_keywords ORDER BY category, keyword",
		)
		.all();
}

export function upsertKeyword(db: DB, keyword: string, category: string): void {
	db.prepare(
		"INSERT INTO category_keywords (keyword, category) VALUES (?, ?) ON CONFLICT (keyword) DO UPDATE SET category = excluded.category",
	).run(keyword.toLowerCase(), category);
}

export function deleteKeyword(db: DB, keyword: string): void {
	db.prepare("DELETE FROM category_keywords WHERE keyword = ?").run(keyword);
}

export function listCategories(db: DB): string[] {
	return db
		.prepare<[], { category: string }>(
			"SELECT category FROM category_keywords UNION SELECT category FROM expenses UNION SELECT 'Lainnya' ORDER BY category",
		)
		.all()
		.map((row) => row.category);
}

export function saveExpenses(
	db: DB,
	expenses: ParsedExpense[],
	meta: MessageMeta & { sender: string },
): void {
	const insert = db.prepare(
		"INSERT INTO expenses (amount, description, category, spent_on, sender, wa_message_id, line_no, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
	);
	db.transaction(() => {
		for (const expense of expenses) {
			insert.run(
				expense.amount,
				expense.description,
				expense.category,
				expense.spentOn,
				meta.sender,
				meta.waMessageId,
				expense.lineNo,
				meta.now.toISOString(),
			);
			if (expense.tagged) upsertKeyword(db, expense.description, expense.category);
		}
		markProcessed(db, meta);
	})();
}

export function undoLastMessage(db: DB, meta: MessageMeta): Expense[] {
	return db.transaction(() => {
		const last = db
			.prepare<[], { wa_message_id: string }>(
				"SELECT wa_message_id FROM expenses ORDER BY id DESC LIMIT 1",
			)
			.get();
		if (!last) return [];

		const deleted = db
			.prepare<[string], Expense>(
				`SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE wa_message_id = ? ORDER BY line_no`,
			)
			.all(last.wa_message_id);
		db.prepare("DELETE FROM expenses WHERE wa_message_id = ?").run(last.wa_message_id);
		markProcessed(db, meta);
		return deleted;
	})();
}

export function totalForRange(db: DB, range: DateRange): number {
	const [row] = db
		.prepare<[string, string], { total: number }>(
			"SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE spent_on BETWEEN ? AND ?",
		)
		.all(range.from, range.to);
	return row.total;
}

export function categoryTotals(db: DB, range: DateRange): CategoryTotal[] {
	return db
		.prepare<[string, string], CategoryTotal>(
			"SELECT category, SUM(amount) AS total FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY category ORDER BY total DESC, category",
		)
		.all(range.from, range.to);
}

export function dailyTotals(db: DB, range: DateRange): DailyTotal[] {
	return db
		.prepare<[string, string], DailyTotal>(
			"SELECT spent_on, SUM(amount) AS total FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY spent_on ORDER BY spent_on",
		)
		.all(range.from, range.to);
}

export function listExpenses(
	db: DB,
	range: DateRange,
	category: string | null,
): Expense[] {
	if (category) {
		return db
			.prepare<[string, string, string], Expense>(
				`SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE spent_on BETWEEN ? AND ? AND category = ? ORDER BY spent_on DESC, id DESC`,
			)
			.all(range.from, range.to, category);
	}
	return db
		.prepare<[string, string], Expense>(
			`SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE spent_on BETWEEN ? AND ? ORDER BY spent_on DESC, id DESC`,
		)
		.all(range.from, range.to);
}

export function updateExpense(db: DB, id: number, update: ExpenseUpdate): void {
	db.prepare(
		"UPDATE expenses SET amount = ?, description = ?, category = ?, spent_on = ? WHERE id = ?",
	).run(update.amount, update.description, update.category, update.spentOn, id);
}

export function deleteExpense(db: DB, id: number): void {
	db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
}

export function createLoginToken(db: DB, meta: MessageMeta): string {
	const token = randomToken();
	const expiresAt = new Date(meta.now.getTime() + LOGIN_TOKEN_TTL_MS).toISOString();
	db.transaction(() => {
		db.prepare("INSERT INTO login_tokens (token, expires_at) VALUES (?, ?)").run(
			token,
			expiresAt,
		);
		markProcessed(db, meta);
	})();
	return token;
}

export function consumeLoginToken(db: DB, token: string, now: Date): boolean {
	const result = db
		.prepare(
			"UPDATE login_tokens SET used_at = ? WHERE token = ? AND used_at IS NULL AND expires_at > ?",
		)
		.run(now.toISOString(), token, now.toISOString());
	return result.changes === 1;
}
```

- [ ] **Step 6: Drop awaits on db calls in the callers**

- `src/bot.ts`: `handleMessage` becomes `export function handleMessage(...): string`; remove every `await` (all callees are now synchronous).
- `src/routes/webhook.ts`: `if (isProcessed(c.env.DB, message.id)) continue;` and `const reply = handleMessage(c.env, message, new Date());` (`sendText` stays awaited).
- `src/routes/login.tsx`: `if (!consumeLoginToken(c.env.DB, token, now)) {`.
- `src/routes/dashboard.tsx`: replace the `Promise.all([...])` destructuring with direct calls:

```tsx
	const total = totalForRange(db, range);
	const prevTotal = totalForRange(db, monthRange(prevMonth));
	const dailyRows = dailyTotals(db, range);
	const categories = categoryTotals(db, range);
	const expenses = listExpenses(db, range, categoryFilter);
	const categoryOptions = listCategories(db);
```

  and remove `await` before `updateExpense` and `deleteExpense`.
- `src/routes/categories.tsx`: `const keywords = getKeywords(c.env.DB);`, `const categoryOptions = listCategories(c.env.DB);`, and remove `await` before `upsertKeyword` / `deleteKeyword`.

Tests keep their `await` on these calls; awaiting a plain value is harmless and keeps the assertions unchanged.

- [ ] **Step 7: Run everything**

Run: `pnpm exec biome check --write . && pnpm test && pnpm typecheck && pnpm lint`
Expected: all tests pass (124 − 1 removed migrations test + 4 migrate tests = 127), typecheck and lint clean. `src/crypto.ts` uses the global `crypto` and `CryptoKey`, which `@types/node` 22 declares; if `tsc` cannot find them, check that `"types": ["node"]` is set rather than adding the `DOM` lib.

- [ ] **Step 8: Commit** (only if authorized)

```bash
git add -A
git commit -m "refactor(db): move from D1 to better-sqlite3 on Node"
git push
```

---

### Task 2: Config and the Node server entry point

**Files:**
- Create: `src/config.ts`, `src/server.ts`, `test/config.test.ts`, `.env.example`

**Interfaces:**
- Produces:

```ts
// config.ts
export type Config = { port: number; databasePath: string; bindings: Omit<Bindings, "DB"> };
export function loadConfig(source: Record<string, string | undefined>): Config;
```

- [ ] **Step 1: Write the failing test**

`test/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const COMPLETE = {
	PORT: "3000",
	DATABASE_PATH: "/var/lib/spendchat/spendchat.db",
	BASE_URL: "https://spendchat.example.my.id",
	OWNER_WA_NUMBER: "6281200000000",
	WA_ACCESS_TOKEN: "access",
	WA_APP_SECRET: "app-secret",
	WA_VERIFY_TOKEN: "verify",
	WA_PHONE_NUMBER_ID: "1234567890",
	SESSION_SECRET: "session",
};

describe("loadConfig", () => {
	it("builds bindings from a complete environment", () => {
		expect(loadConfig(COMPLETE)).toEqual({
			port: 3000,
			databasePath: "/var/lib/spendchat/spendchat.db",
			bindings: {
				BASE_URL: "https://spendchat.example.my.id",
				OWNER_WA_NUMBER: "6281200000000",
				WA_ACCESS_TOKEN: "access",
				WA_APP_SECRET: "app-secret",
				WA_VERIFY_TOKEN: "verify",
				WA_PHONE_NUMBER_ID: "1234567890",
				SESSION_SECRET: "session",
			},
		});
	});

	it("names every missing or empty variable", () => {
		expect(() => loadConfig({ ...COMPLETE, WA_APP_SECRET: "", SESSION_SECRET: undefined })).toThrow(
			"Missing environment variables: WA_APP_SECRET, SESSION_SECRET",
		);
	});

	it("rejects a port that is not a port number", () => {
		expect(() => loadConfig({ ...COMPLETE, PORT: "abc" })).toThrow("PORT must be a port number");
		expect(() => loadConfig({ ...COMPLETE, PORT: "70000" })).toThrow("PORT must be a port number");
	});
});
```

Run: `pnpm test test/config.test.ts` → FAIL (cannot resolve `../src/config`).

- [ ] **Step 2: Implement config**

`src/config.ts`:

```ts
import type { Bindings } from "./env";

export type Config = {
	port: number;
	databasePath: string;
	bindings: Omit<Bindings, "DB">;
};

const REQUIRED = [
	"PORT",
	"DATABASE_PATH",
	"BASE_URL",
	"OWNER_WA_NUMBER",
	"WA_ACCESS_TOKEN",
	"WA_APP_SECRET",
	"WA_VERIFY_TOKEN",
	"WA_PHONE_NUMBER_ID",
	"SESSION_SECRET",
] as const;

export function loadConfig(source: Record<string, string | undefined>): Config {
	const missing = REQUIRED.filter((name) => !source[name]);
	if (missing.length > 0) {
		throw new Error(`Missing environment variables: ${missing.join(", ")}`);
	}
	const value = (name: (typeof REQUIRED)[number]) => source[name] as string;

	const port = Number(value("PORT"));
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("PORT must be a port number");
	}

	return {
		port,
		databasePath: value("DATABASE_PATH"),
		bindings: {
			BASE_URL: value("BASE_URL"),
			OWNER_WA_NUMBER: value("OWNER_WA_NUMBER"),
			WA_ACCESS_TOKEN: value("WA_ACCESS_TOKEN"),
			WA_APP_SECRET: value("WA_APP_SECRET"),
			WA_VERIFY_TOKEN: value("WA_VERIFY_TOKEN"),
			WA_PHONE_NUMBER_ID: value("WA_PHONE_NUMBER_ID"),
			SESSION_SECRET: value("SESSION_SECRET"),
		},
	};
}
```

(The `as string` is safe: `missing` already proved every name is a non-empty string.)

Run: `pnpm test test/config.test.ts` → PASS.

- [ ] **Step 3: Server entry point**

`src/server.ts`:

```ts
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
const applied = migrate(db, fileURLToPath(new URL("../migrations", import.meta.url)));
if (applied.length > 0) console.log(`Applied migrations: ${applied.join(", ")}`);

const env = { ...config.bindings, DB: db };
serve({ fetch: (request) => app.fetch(request, env), hostname: "127.0.0.1", port: config.port });
console.log(`SpendChat listening on 127.0.0.1:${config.port}`);
```

`.env.example`:

```
PORT=3000
DATABASE_PATH=.data/spendchat.db
BASE_URL=http://localhost:3000
OWNER_WA_NUMBER=62812xxxxxxxx
WA_ACCESS_TOKEN=
WA_APP_SECRET=
WA_VERIFY_TOKEN=
WA_PHONE_NUMBER_ID=
SESSION_SECRET=
```

- [ ] **Step 4: Smoke-run the built server locally**

Create `.env` (gitignored) from `.env.example` with dummy values for every variable (e.g. `dev-…` strings; `OWNER_WA_NUMBER=6281200000000`), and `mkdir .data`. Then:

```bash
pnpm build
node --env-file=.env dist/server.js
```

In another shell:

```bash
curl -s "http://127.0.0.1:3000/webhook?hub.mode=subscribe&hub.verify_token=<WA_VERIFY_TOKEN from .env>&hub.challenge=ok"
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=ok"
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login
```

Expected: `ok`, `403`, `200`; the server log shows `Applied migrations: 0001_init.sql, 0002_seed_keywords.sql` on the first start only. Also start once with `WA_APP_SECRET` removed from `.env` and confirm it exits with `Missing environment variables: WA_APP_SECRET`. Stop the server.

- [ ] **Step 5: Full suite, typecheck, lint, commit** (commit only if authorized)

Run: `pnpm exec biome check --write . && pnpm test && pnpm typecheck && pnpm lint`

```bash
git add src/config.ts src/server.ts test/config.test.ts .env.example
git commit -m "feat(server): add Node entry point with validated env config"
git push
```

---

### Task 3: Deploy files and README

**Files:**
- Create: `deploy/spendchat.service`, `deploy/spendchat-backup.service`, `deploy/spendchat-backup.timer`, `deploy/backup.sh`
- Modify: `README.md`

- [ ] **Step 1: systemd and backup files**

`deploy/spendchat.service`:

```ini
[Unit]
Description=SpendChat
After=network-online.target
Wants=network-online.target

[Service]
User=spendchat
WorkingDirectory=/opt/spendchat
EnvironmentFile=/etc/spendchat.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`deploy/spendchat-backup.service`:

```ini
[Unit]
Description=SpendChat database backup

[Service]
Type=oneshot
User=spendchat
ExecStart=/bin/sh /opt/spendchat/deploy/backup.sh
```

`deploy/spendchat-backup.timer`:

```ini
[Unit]
Description=Daily SpendChat database backup

[Timer]
OnCalendar=*-*-* 03:00:00 Asia/Jakarta
Persistent=true

[Install]
WantedBy=timers.target
```

`deploy/backup.sh`:

```sh
#!/bin/sh
set -eu

data=/var/lib/spendchat
sqlite3 "$data/spendchat.db" ".backup '$data/backups/spendchat-$(TZ=Asia/Jakarta date +%F).db'"
# Keep 14 days: -mtime +13 matches files last modified more than 14 days ago.
find "$data/backups" -name 'spendchat-*.db' -mtime +13 -delete
```

- [ ] **Step 2: Rewrite README.md**

Keep the title, intro (replace "Runs on Cloudflare Workers + D1." with "Runs as a Node.js service with SQLite on a small VPS."), and the "Chat usage" section unchanged. Replace everything after it with:

````markdown
## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

To run locally: copy `.env.example` to `.env`, fill every value (dummy values are fine), `mkdir .data`, then `pnpm dev`. The app listens on `http://127.0.0.1:3000`.

## Server setup (Ubuntu 24.04 VPS)

Prerequisites: a VPS reachable over SSH as root with your key, and a DNS `A` record `spendchat.<domain>` pointing at its IP.

As root on the VPS:

```bash
apt update && apt upgrade -y
apt install -y curl git sqlite3 ufw debian-keyring debian-archive-keyring apt-transport-https gnupg

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
corepack enable

curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

useradd --system --home-dir /opt/spendchat --shell /usr/sbin/nologin spendchat
git clone https://github.com/ahmadafienzidan/spendchat.git /opt/spendchat
chown -R spendchat: /opt/spendchat
install -d -o spendchat -g spendchat -m 700 /var/lib/spendchat /var/lib/spendchat/backups

cd /opt/spendchat
sudo -u spendchat env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile
sudo -u spendchat pnpm build
```

Environment file (replace `<domain>`; `SESSION_SECRET` is generated here):

```bash
install -m 600 /dev/null /etc/spendchat.env
cat > /etc/spendchat.env <<EOF
PORT=3000
DATABASE_PATH=/var/lib/spendchat/spendchat.db
BASE_URL=https://spendchat.<domain>
SESSION_SECRET=$(openssl rand -hex 32)
OWNER_WA_NUMBER=
WA_ACCESS_TOKEN=
WA_APP_SECRET=
WA_VERIFY_TOKEN=
WA_PHONE_NUMBER_ID=
EOF
```

Fill the empty values yourself with `nano /etc/spendchat.env` (see WhatsApp setup below). `OWNER_WA_NUMBER` is your personal number without `+`, e.g. `6281234567890`; `WA_VERIFY_TOKEN` is any long random string you choose.

HTTPS and services:

```bash
cat > /etc/caddy/Caddyfile <<EOF
spendchat.<domain> {
	reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy

cp /opt/spendchat/deploy/spendchat.service /opt/spendchat/deploy/spendchat-backup.service /opt/spendchat/deploy/spendchat-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now spendchat-backup.timer
systemctl enable --now spendchat
```

Check: `systemctl status spendchat`, `curl -I https://spendchat.<domain>/login` (200).

## Updating

```bash
cd /opt/spendchat
sudo -u spendchat git pull
sudo -u spendchat pnpm install --frozen-lockfile
sudo -u spendchat pnpm build
systemctl restart spendchat
```

Migrations run automatically on start.

## Backups

Daily at 03:00 WIB into `/var/lib/spendchat/backups/spendchat-YYYY-MM-DD.db`, kept 14 days. Run one now with `systemctl start spendchat-backup.service`. To restore: `systemctl stop spendchat`, copy a backup over `/var/lib/spendchat/spendchat.db` (owner `spendchat`), delete any `spendchat.db-wal` and `spendchat.db-shm` next to it, `systemctl start spendchat`.

## WhatsApp Cloud API setup

1. At developers.facebook.com create an app of type **Business** and add the **WhatsApp** product.
2. Under WhatsApp → API Setup, add the bot's phone number. It must not be registered in the WhatsApp or WhatsApp Business app; delete that account from the app first. Note the **Phone number ID** → `WA_PHONE_NUMBER_ID`.
3. App Settings → Basic → **App secret** → `WA_APP_SECRET`.
4. In Business Settings create a **System User**, assign the app and the WhatsApp account, and generate a token with `whatsapp_business_messaging` and `whatsapp_business_management` → `WA_ACCESS_TOKEN`. The temporary token on the API Setup page expires in 24 hours; don't use it.
5. After filling `/etc/spendchat.env`: `systemctl restart spendchat`.
6. WhatsApp → Configuration → Webhook: callback URL `https://spendchat.<domain>/webhook`, verify token = `WA_VERIFY_TOKEN`. Then subscribe to the **messages** field.
7. From your personal number, send `bantuan` to the bot's number.

Logs: `journalctl -u spendchat -f`.
````

- [ ] **Step 3: Lint, commit** (commit only if authorized)

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add deploy README.md
git commit -m "docs(deploy): add systemd units, backup script and VPS guide"
git push
```

---

### Task 4: Server setup over SSH (needs the user's approval in chat)

Prerequisites from the user: VPS created with the public key from Step 1, its IP, the domain, and the DNS `A` record in place.

- [ ] **Step 1: SSH key (laptop)**

If `~/.ssh/id_ed25519` does not exist: `ssh-keygen -t ed25519 -C spendchat-vps -f ~/.ssh/id_ed25519 -N ""`. Show the user `~/.ssh/id_ed25519.pub`. (No passphrase so that commands can run non-interactively; the user can add one later with `ssh-keygen -p`.)

- [ ] **Step 2: Confirm reachability**

`dig +short spendchat.<domain>` (or `nslookup`) returns the VPS IP; `ssh -o StrictHostKeyChecking=accept-new root@<ip> 'cat /etc/os-release | head -2'` shows Ubuntu 24.04. Ask the user to approve running the setup before Step 3.

- [ ] **Step 3: Run README "Server setup" up to and including writing `/etc/spendchat.env`**, then the Caddy, `cp`, `daemon-reload`, and `enable --now spendchat-backup.timer` commands. Do **not** start `spendchat` yet (it would exit with missing variables).

- [ ] **Step 4: Hand over to the user** to fill `OWNER_WA_NUMBER` and the four `WA_*` values with `nano /etc/spendchat.env` over their own SSH session. Wait for them to confirm. Do not print the file.

- [ ] **Step 5: Start and verify**

```bash
systemctl enable --now spendchat
systemctl is-active spendchat
journalctl -u spendchat -n 20 --no-pager
curl -s -o /dev/null -w "%{http_code}\n" https://spendchat.<domain>/login
curl -s -o /dev/null -w "%{http_code}\n" "https://spendchat.<domain>/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x"
systemctl start spendchat-backup.service && ls -l /var/lib/spendchat/backups
systemctl list-timers spendchat-backup.timer --no-pager
```

Expected: `active`; log shows the applied migrations and `listening`; `200`; `403`; one backup file for today; the timer's next run at 03:00 WIB (shown in the server's time zone).

---

### Task 5: Meta webhook and end-to-end check (user)

- [ ] **Step 1:** The user registers the webhook (README "WhatsApp Cloud API setup" step 6). Meta's **Verify and save** succeeding proves `WA_VERIFY_TOKEN` matches.
- [ ] **Step 2:** The user sends `bantuan`, then `bensin 50\nmakan 20`, then `dashboard` from their personal number; check replies arrive and the dashboard login works on their phone.
- [ ] **Step 3:** If anything fails, read `journalctl -u spendchat -n 50 --no-pager` and debug with superpowers:systematic-debugging.
