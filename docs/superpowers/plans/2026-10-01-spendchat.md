# SpendChat Implementation Plan

> **Status:** completed on Cloudflare Workers + D1 (commits up to `f835def`). Hosting moved to a VPS on 2026-10-07; follow `docs/superpowers/plans/2026-10-07-spendchat-vps.md` for that port. Tasks below describe the original Cloudflare build.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cloudflare Worker that records the owner's expenses from WhatsApp messages (Cloud API webhook) into D1, answers summary commands in chat, and serves a magic-link-protected dashboard to review and edit them.

**Architecture:** One Hono app on Cloudflare Workers. A pure `parser` turns message text into expenses or commands; `bot` applies them to D1 through `db` and builds the reply text with `replies`; `routes/webhook` verifies Meta's signature and sends replies via `whatsapp`. Dashboard pages are server-rendered Hono JSX with plain HTML forms and CSS bar charts, guarded by an HMAC-signed session cookie obtained through a one-time link sent over WhatsApp.

**Tech Stack:** TypeScript (strict), Hono 4, Cloudflare Workers + D1, Wrangler 4, Vitest 4 + `@cloudflare/vitest-pool-workers` 0.22, Biome 2, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-01-spendchat-design.md`

## Global Constraints

- Package manager: **pnpm** only. Linter/formatter: **Biome** only (no ESLint/Prettier).
- Code, identifiers, comments, commit messages, docs: English. User-facing bot and dashboard text: Indonesian, exactly as written in this plan. Chat commands are accepted in Indonesian and English (spec §7.1).
- Names: product `SpendChat` (page titles, headings); technical `spendchat` (package, Worker, D1 database).
- No defensive try/catch, no fallback values "just in case"; let errors surface. Comments only for non-obvious code.
- All dates/hours in WIB (UTC+7, no DST). The reference time for a WhatsApp message is its `timestamp`, not the Worker clock.
- Amounts are integer rupiah. Display format `Rp` + `Intl.NumberFormat("id-ID")` → `Rp1.500.000`.
- `compatibility_date` must not be later than the workerd bundled by `@cloudflare/vitest-pool-workers` (`2026-08-15`).
- Commits: Conventional Commits with a mandatory scope, e.g. `feat(parser): ...`. No AI attribution (no `Co-Authored-By` trailers). **Only commit if the user has authorized committing in the current session.** If a git remote exists, push after every commit; the repo currently has no remote.
- Before marking a task done: `pnpm test`, `pnpm typecheck`, `pnpm lint` all pass. Paste real output.

## File Structure

```
spendchat/
├─ package.json, pnpm-lock.yaml, tsconfig.json, biome.json, wrangler.jsonc, vitest.config.ts
├─ .gitignore, .dev.vars.example, README.md
├─ migrations/
│  ├─ 0001_init.sql            tables
│  └─ 0002_seed_keywords.sql   default keyword → category rows (re-run by tests to reset)
├─ src/
│  ├─ index.ts                 Hono app: mounts routes, session guard
│  ├─ env.ts                   Bindings / AppEnv types
│  ├─ time.ts                  WIB date helpers, ranges, month labels
│  ├─ money.ts                 formatRupiah
│  ├─ parser.ts                text → command | parsed lines (pure)
│  ├─ crypto.ts                HMAC sign/verify, random tokens
│  ├─ db.ts                    all D1 queries
│  ├─ whatsapp.ts              signature check, payload extraction, sendText
│  ├─ replies.ts               reply text builders
│  ├─ bot.ts                   handleMessage: message → DB changes + reply
│  ├─ auth.ts                  session cookie + requireSession middleware
│  ├─ routes/webhook.ts        GET/POST /webhook
│  ├─ routes/login.tsx         GET/POST /login
│  ├─ routes/dashboard.tsx     /dashboard, /expenses/*
│  ├─ routes/categories.tsx    /categories*
│  └─ views/
│     ├─ layout.tsx            html shell + CSS
│     ├─ styles.ts             CSS string with light/dark tokens
│     ├─ login.tsx
│     ├─ dashboard.tsx
│     └─ categories.tsx
└─ test/
   ├─ env.d.ts                 Cloudflare.Env augmentation for tests
   ├─ setup.ts                 apply migrations, reset tables before each test
   ├─ helpers.ts               payload/message builders, signed requests, session cookie
   └─ *.test.ts
```

---

### Task 1: Project scaffold, D1 schema, test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `wrangler.jsonc`, `vitest.config.ts`, `.gitignore`, `.dev.vars.example`
- Create: `migrations/0001_init.sql`, `migrations/0002_seed_keywords.sql`
- Create: `src/env.ts`, `src/index.ts`
- Create: `test/env.d.ts`, `test/setup.ts`, `test/migrations.test.ts`

**Interfaces:**
- Produces: `Bindings`, `AppEnv` (from `src/env.ts`); default export `app` (Hono) from `src/index.ts`; test env bindings listed in `vitest.config.ts`; per-test DB reset.

- [ ] **Step 1: Create package.json and install dependencies**

`package.json`:

```json
{
  "name": "spendchat",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "biome check ."
  }
}
```

Run:

```bash
pnpm add hono
pnpm add -D wrangler typescript @cloudflare/workers-types @cloudflare/vitest-pool-workers "vitest@^4.1.0" @biomejs/biome
```

If pnpm reports ignored build scripts (esbuild, workerd, sharp), allow them non-interactively the way the pnpm message instructs (e.g. `onlyBuiltDependencies` / `allowBuilds` in `pnpm-workspace.yaml`) and re-run `pnpm install`. Do not switch package managers.

- [ ] **Step 2: Config files**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "es2022",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers/types"],
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

Run `pnpm exec biome init` to create `biome.json`, then make sure it ignores generated folders by setting `"files": { "includes": ["**", "!node_modules", "!.wrangler"] }` (Biome 2 syntax; keep everything else as generated).

`wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "spendchat",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-15",
  "vars": {
    "BASE_URL": "http://localhost:8787"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "spendchat",
      "database_id": "local",
      "migrations_dir": "migrations"
    }
  ]
}
```

(`database_id` and `BASE_URL` get their real values in Task 13.)

`vitest.config.ts`:

```ts
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BASE_URL: "https://spendchat.test",
            WA_ACCESS_TOKEN: "test-access-token",
            WA_APP_SECRET: "test-app-secret",
            WA_VERIFY_TOKEN: "test-verify-token",
            WA_PHONE_NUMBER_ID: "1234567890",
            OWNER_WA_NUMBER: "6281200000000",
            SESSION_SECRET: "test-session-secret",
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
```

`.gitignore`:

```
node_modules
.wrangler
.dev.vars
```

`.dev.vars.example`:

```
WA_ACCESS_TOKEN=
WA_APP_SECRET=
WA_VERIFY_TOKEN=
WA_PHONE_NUMBER_ID=
OWNER_WA_NUMBER=62812xxxxxxxx
SESSION_SECRET=
```

- [ ] **Step 3: Migrations**

`migrations/0001_init.sql`:

```sql
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  amount INTEGER NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  spent_on TEXT NOT NULL,
  sender TEXT NOT NULL,
  wa_message_id TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (wa_message_id, line_no)
);

CREATE INDEX expenses_spent_on ON expenses (spent_on);

CREATE TABLE category_keywords (
  keyword TEXT PRIMARY KEY,
  category TEXT NOT NULL
);

CREATE TABLE login_tokens (
  token TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE processed_messages (
  wa_message_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);
```

`migrations/0002_seed_keywords.sql`:

```sql
INSERT INTO category_keywords (keyword, category) VALUES
  ('makan', 'Makan'), ('sarapan', 'Makan'), ('kopi', 'Makan'), ('nasi', 'Makan'),
  ('minum', 'Makan'), ('snack', 'Makan'), ('jajan', 'Makan'),
  ('bensin', 'Transport'), ('grab', 'Transport'), ('gojek', 'Transport'), ('ojek', 'Transport'),
  ('parkir', 'Transport'), ('tol', 'Transport'), ('krl', 'Transport'), ('bus', 'Transport'),
  ('cuci', 'Laundry'), ('laundry', 'Laundry'),
  ('belanja', 'Belanja'), ('indomaret', 'Belanja'), ('alfamart', 'Belanja'),
  ('listrik', 'Tagihan'), ('pulsa', 'Tagihan'), ('internet', 'Tagihan'), ('wifi', 'Tagihan'), ('pdam', 'Tagihan'),
  ('obat', 'Kesehatan'), ('dokter', 'Kesehatan');
```

- [ ] **Step 4: Env types and empty app**

`src/env.ts`:

```ts
export type Bindings = {
  DB: D1Database;
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

`src/index.ts`:

```ts
import { Hono } from "hono";
import type { AppEnv } from "./env";

const app = new Hono<AppEnv>();

export default app;
```

- [ ] **Step 5: Test harness**

`test/env.d.ts`:

```ts
import type { D1Migration } from "cloudflare:test";
import type { Bindings } from "../src/env";

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
```

`test/setup.ts`:

```ts
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
```

- [ ] **Step 6: Write the smoke test**

`test/migrations.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("migrations", () => {
  it("creates tables and seeds keywords", async () => {
    const row = await env.DB.prepare("SELECT category FROM category_keywords WHERE keyword = ?")
      .bind("bensin")
      .first<{ category: string }>();
    expect(row?.category).toBe("Transport");

    const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM expenses").all<{ n: number }>();
    expect(results[0].n).toBe(0);
  });
});
```

- [ ] **Step 7: Run tests, typecheck, lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 1 test passes; typecheck and lint clean. If `biome check` only reports formatting, run `pnpm exec biome check --write .` and re-run.

- [ ] **Step 8: Commit** (only if authorized)

```bash
git add -A
git commit -m "chore(setup): scaffold worker, D1 schema and test harness"
```

---

### Task 2: WIB time helpers and rupiah formatting

**Files:**
- Create: `src/time.ts`, `src/money.ts`
- Test: `test/time.test.ts`, `test/money.test.ts`

**Interfaces:**
- Produces:
  - `type DateRange = { from: string; to: string }` (inclusive `YYYY-MM-DD`)
  - `wibDate(date: Date): string`, `wibHour(date: Date): number`, `wibMonth(date: Date): string`
  - `addDays(isoDate: string, days: number): string`
  - `dayRange(date: Date): DateRange`, `weekRange(date: Date): DateRange`, `monthRange(month: string): DateRange`
  - `shiftMonth(month: string, delta: number): string`, `monthLabel(month: string): string`
  - `formatRupiah(amount: number): string`

- [ ] **Step 1: Write failing tests**

`test/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addDays,
  dayRange,
  monthLabel,
  monthRange,
  shiftMonth,
  weekRange,
  wibDate,
  wibHour,
  wibMonth,
} from "../src/time";

describe("time", () => {
  it("converts UTC instants to WIB date, hour and month", () => {
    const lateUtc = new Date("2026-09-30T17:30:00Z"); // 00:30 WIB on Oct 1
    expect(wibDate(lateUtc)).toBe("2026-10-01");
    expect(wibHour(lateUtc)).toBe(0);
    expect(wibMonth(lateUtc)).toBe("2026-10");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("builds a single-day range", () => {
    expect(dayRange(new Date("2026-10-01T05:00:00Z"))).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });

  it("builds a Monday–Sunday week", () => {
    // 2026-10-01 is a Thursday
    expect(weekRange(new Date("2026-10-01T05:00:00Z"))).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    // Sunday belongs to the week that started on the previous Monday
    expect(weekRange(new Date("2026-10-04T05:00:00Z"))).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    // Monday starts a new week
    expect(weekRange(new Date("2026-10-05T05:00:00Z"))).toEqual({ from: "2026-10-05", to: "2026-10-11" });
  });

  it("builds month ranges including leap years", () => {
    expect(monthRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("shifts months across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("labels months in Indonesian", () => {
    expect(monthLabel("2026-10")).toBe("Oktober 2026");
  });
});
```

`test/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatRupiah } from "../src/money";

describe("formatRupiah", () => {
  it("uses Indonesian thousands separators", () => {
    expect(formatRupiah(0)).toBe("Rp0");
    expect(formatRupiah(18000)).toBe("Rp18.000");
    expect(formatRupiah(1500000)).toBe("Rp1.500.000");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/time.test.ts test/money.test.ts`
Expected: FAIL — cannot resolve `../src/time` / `../src/money`.

- [ ] **Step 3: Implement**

`src/time.ts`:

```ts
export type DateRange = { from: string; to: string };

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Shifting by the offset lets the UTC getters read WIB wall-clock values.
function toWib(date: Date): Date {
  return new Date(date.getTime() + WIB_OFFSET_MS);
}

export function wibDate(date: Date): string {
  return toWib(date).toISOString().slice(0, 10);
}

export function wibHour(date: Date): number {
  return toWib(date).getUTCHours();
}

export function wibMonth(date: Date): string {
  return wibDate(date).slice(0, 7);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dayRange(date: Date): DateRange {
  const day = wibDate(date);
  return { from: day, to: day };
}

export function weekRange(date: Date): DateRange {
  const day = wibDate(date);
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const from = addDays(day, -((weekday + 6) % 7));
  return { from, to: addDays(from, 6) };
}

export function monthRange(month: string): DateRange {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7);
}

const monthFormat = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });

export function monthLabel(month: string): string {
  return monthFormat.format(new Date(`${month}-01T00:00:00Z`));
}
```

`src/money.ts`:

```ts
const rupiah = new Intl.NumberFormat("id-ID");

export function formatRupiah(amount: number): string {
  return `Rp${rupiah.format(amount)}`;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test test/time.test.ts test/money.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit** (commit only if authorized)

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/time.ts src/money.ts test/time.test.ts test/money.test.ts
git commit -m "feat(time): add WIB date helpers and rupiah formatting"
```

---

### Task 3: Parser — amounts

**Files:**
- Create: `src/parser.ts`
- Test: `test/parser-amount.test.ts`

**Interfaces:**
- Produces: `parseAmount(token: string): number | null`

- [ ] **Step 1: Write failing tests**

`test/parser-amount.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseAmount } from "../src/parser";

describe("parseAmount", () => {
  it.each([
    ["25000", 25_000],
    ["25.000", 25_000],
    ["25,000", 25_000],
    ["1.500.000", 1_500_000],
    ["25rb", 25_000],
    ["25ribu", 25_000],
    ["18k", 18_000],
    ["18K", 18_000],
    ["2.5k", 2_500],
    ["1,5rb", 1_500],
    ["1.5jt", 1_500_000],
    ["1,5jt", 1_500_000],
    ["2juta", 2_000_000],
  ])("parses %s", (token, expected) => {
    expect(parseAmount(token)).toBe(expected);
  });

  it("treats bare numbers below 1000 as thousands", () => {
    expect(parseAmount("50")).toBe(50_000);
    expect(parseAmount("7")).toBe(7_000);
    expect(parseAmount("999")).toBe(999_000);
    expect(parseAmount("1000")).toBe(1_000);
  });

  it.each(["makan", "pagi", "#jajan", "0", "0rb", "1.500.000jt", "12abc", ""])("rejects %j", (token) => {
    expect(parseAmount(token)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/parser-amount.test.ts`
Expected: FAIL — cannot resolve `../src/parser`.

- [ ] **Step 3: Implement**

`src/parser.ts`:

```ts
const AMOUNT = /^(\d+(?:[.,]\d+)*)(rb|ribu|k|jt|juta)?$/i;

const MULTIPLIERS: Record<string, number> = {
  rb: 1_000,
  ribu: 1_000,
  k: 1_000,
  jt: 1_000_000,
  juta: 1_000_000,
};

export function parseAmount(token: string): number | null {
  const match = AMOUNT.exec(token);
  if (!match) return null;
  const [, digits, suffix] = match;

  let amount: number;
  if (suffix) {
    // With a suffix the separator is decimal: 1,5jt = 1.5 million.
    amount = Number(digits.replace(",", ".")) * MULTIPLIERS[suffix.toLowerCase()];
  } else {
    amount = Number(digits.replace(/[.,]/g, ""));
    if (amount < 1000) amount *= 1000;
  }

  amount = Math.round(amount);
  return amount > 0 ? amount : null;
}
```

(`1.500.000jt` gives `Number("1.500.000")` = `NaN`, and `NaN > 0` is false, so it returns `null`.)

- [ ] **Step 4: Run tests**

Run: `pnpm test test/parser-amount.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit** (commit only if authorized)

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/parser.ts test/parser-amount.test.ts
git commit -m "feat(parser): parse rupiah amounts with suffixes and implicit thousands"
```

---

### Task 4: Parser — lines, meal time, categories, commands

**Files:**
- Modify: `src/parser.ts`
- Test: `test/parser.test.ts`

**Interfaces:**
- Consumes: `parseAmount` (Task 3); `wibDate`, `wibHour`, `addDays` (Task 2).
- Produces:

```ts
export type Command = "today" | "week" | "month" | "undo" | "dashboard" | "help";
export type Keyword = { keyword: string; category: string };
export type ParsedExpense = {
  ok: true; lineNo: number; amount: number; description: string;
  category: string; spentOn: string; tagged: boolean;
};
export type SkippedLine = { ok: false; lineNo: number; line: string; reason: "no_amount" | "no_description" };
export type ParsedLine = ParsedExpense | SkippedLine;
export type ParsedMessage = { kind: "command"; command: Command } | { kind: "expenses"; lines: ParsedLine[] };
export function isExpense(line: ParsedLine): line is ParsedExpense;
export function parseMessage(text: string, sentAt: Date, keywords: Keyword[]): ParsedMessage;
```

- [ ] **Step 1: Write failing tests**

`test/parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type Keyword, type ParsedLine, parseMessage } from "../src/parser";

const KEYWORDS: Keyword[] = [
  { keyword: "makan", category: "Makan" },
  { keyword: "sarapan", category: "Makan" },
  { keyword: "bensin", category: "Transport" },
  { keyword: "cuci", category: "Laundry" },
  { keyword: "sewa", category: "Tempat" },
  { keyword: "sewa kos", category: "Kos" },
];

// 12:00 WIB on Thursday 2026-10-01
const NOON = new Date("2026-10-01T05:00:00Z");

function wibAt(hhmm: string): Date {
  return new Date(`2026-10-01T${hhmm}:00+07:00`);
}

function lines(text: string, sentAt = NOON): ParsedLine[] {
  const parsed = parseMessage(text, sentAt, KEYWORDS);
  if (parsed.kind !== "expenses") throw new Error(`expected expenses, got ${parsed.command}`);
  return parsed.lines;
}

describe("parseMessage commands", () => {
  it.each([
    ["hari ini", "today"],
    ["  Hari   Ini ", "today"],
    ["minggu ini", "week"],
    ["BULAN INI", "month"],
    ["hapus", "undo"],
    ["dashboard", "dashboard"],
    ["bantuan", "help"],
    ["help", "help"],
    ["today", "today"],
    ["This Week", "week"],
    ["this month", "month"],
    ["undo", "undo"],
  ])("recognizes %j", (text, command) => {
    expect(parseMessage(text, NOON, KEYWORDS)).toEqual({ kind: "command", command });
  });

  it("only matches whole-message commands", () => {
    expect(parseMessage("hari ini makan 20", NOON, KEYWORDS).kind).toBe("expenses");
    expect(parseMessage("today makan 20", NOON, KEYWORDS).kind).toBe("expenses");
  });

  it("does not treat object prototype keys as commands", () => {
    expect(parseMessage("constructor", NOON, KEYWORDS).kind).toBe("expenses");
  });
});

describe("parseMessage expenses", () => {
  it("parses the multi-line example at noon", () => {
    expect(lines("bensin 50\nmakan 20\nsarapan 10\nmakan pagi 7\ncuci 18")).toEqual([
      { ok: true, lineNo: 1, amount: 50_000, description: "bensin", category: "Transport", spentOn: "2026-10-01", tagged: false },
      { ok: true, lineNo: 2, amount: 20_000, description: "makan siang", category: "Makan", spentOn: "2026-10-01", tagged: false },
      { ok: true, lineNo: 3, amount: 10_000, description: "sarapan", category: "Makan", spentOn: "2026-10-01", tagged: false },
      { ok: true, lineNo: 4, amount: 7_000, description: "makan pagi", category: "Makan", spentOn: "2026-10-01", tagged: false },
      { ok: true, lineNo: 5, amount: 18_000, description: "cuci", category: "Laundry", spentOn: "2026-10-01", tagged: false },
    ]);
  });

  it("ignores blank lines when numbering", () => {
    const [first, second] = lines("bensin 50\n\n  \ncuci 18");
    expect(first.lineNo).toBe(1);
    expect(second.lineNo).toBe(2);
  });

  it.each([
    ["03:59", "makan malam"],
    ["04:00", "makan pagi"],
    ["10:59", "makan pagi"],
    ["11:00", "makan siang"],
    ["14:59", "makan siang"],
    ["15:00", "makan sore"],
    ["17:59", "makan sore"],
    ["18:00", "makan malam"],
  ])("labels a bare 'makan' at %s as %s", (time, description) => {
    expect(lines("makan 20", wibAt(time))[0]).toMatchObject({ description });
  });

  it("labels 'Makan' case-insensitively", () => {
    expect(lines("Makan 20")[0]).toMatchObject({ description: "makan siang" });
  });

  it("dates 'kemarin' lines yesterday and keeps bare 'makan'", () => {
    expect(lines("kemarin makan 20")[0]).toMatchObject({
      amount: 20_000,
      description: "makan",
      category: "Makan",
      spentOn: "2026-09-30",
    });
    expect(lines("Kemarin parkir 5rb")[0]).toMatchObject({ amount: 5_000, description: "parkir", spentOn: "2026-09-30" });
  });

  it("accepts 'yesterday' like 'kemarin'", () => {
    expect(lines("yesterday parkir 5rb")[0]).toMatchObject({ amount: 5_000, description: "parkir", spentOn: "2026-09-30" });
    expect(lines("Yesterday makan 20")[0]).toMatchObject({ description: "makan", spentOn: "2026-09-30" });
  });

  it("uses the WIB date of the message, not UTC", () => {
    // 00:30 WIB on Oct 1 is still Sep 30 in UTC
    expect(lines("bensin 50", new Date("2026-09-30T17:30:00Z"))[0]).toMatchObject({ spentOn: "2026-10-01" });
  });

  it("uses a #tag as the category", () => {
    expect(lines("kopi 18k #jajan")[0]).toMatchObject({
      amount: 18_000,
      description: "kopi",
      category: "Jajan",
      tagged: true,
    });
  });

  it("prefers the longest matching keyword", () => {
    expect(lines("sewa kos 1.5jt")[0]).toMatchObject({ amount: 1_500_000, description: "sewa kos", category: "Kos" });
  });

  it("matches keywords as whole words only", () => {
    expect(lines("pencucian 20")[0]).toMatchObject({ category: "Lainnya" });
  });

  it("falls back to Lainnya", () => {
    expect(lines("buku 45")[0]).toMatchObject({ description: "buku", category: "Lainnya" });
  });

  it("takes the first amount token and keeps later numbers in the description", () => {
    expect(lines("beli 2 tiket 3")[0]).toMatchObject({ amount: 2_000, description: "beli tiket 3" });
  });

  it("skips lines without an amount or a description", () => {
    expect(lines("makan siang\n50\nbensin 50")).toEqual([
      { ok: false, lineNo: 1, line: "makan siang", reason: "no_amount" },
      { ok: false, lineNo: 2, line: "50", reason: "no_description" },
      { ok: true, lineNo: 3, amount: 50_000, description: "bensin", category: "Transport", spentOn: "2026-10-01", tagged: false },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/parser.test.ts`
Expected: FAIL — `parseMessage` is not exported.

- [ ] **Step 3: Implement** — append to `src/parser.ts` (keep `parseAmount` from Task 3) and add the import at the top:

```ts
import { addDays, wibDate, wibHour } from "./time";
```

```ts
export type Command = "today" | "week" | "month" | "undo" | "dashboard" | "help";

export type Keyword = { keyword: string; category: string };

export type ParsedExpense = {
  ok: true;
  lineNo: number;
  amount: number;
  description: string;
  category: string;
  spentOn: string;
  tagged: boolean;
};

export type SkippedLine = {
  ok: false;
  lineNo: number;
  line: string;
  reason: "no_amount" | "no_description";
};

export type ParsedLine = ParsedExpense | SkippedLine;

export type ParsedMessage = { kind: "command"; command: Command } | { kind: "expenses"; lines: ParsedLine[] };

const COMMANDS = new Map<string, Command>([
  ["hari ini", "today"],
  ["minggu ini", "week"],
  ["bulan ini", "month"],
  ["hapus", "undo"],
  ["dashboard", "dashboard"],
  ["bantuan", "help"],
  ["today", "today"],
  ["this week", "week"],
  ["this month", "month"],
  ["undo", "undo"],
  ["help", "help"],
]);

const YESTERDAY_WORDS = new Set(["kemarin", "yesterday"]);

const TAG = /^#(\S+)$/;

export function isExpense(line: ParsedLine): line is ParsedExpense {
  return line.ok;
}

export function parseMessage(text: string, sentAt: Date, keywords: Keyword[]): ParsedMessage {
  const command = COMMANDS.get(text.trim().toLowerCase().replace(/\s+/g, " "));
  if (command) return { kind: "command", command };

  const rawLines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return { kind: "expenses", lines: rawLines.map((line, i) => parseLine(line, i + 1, sentAt, keywords)) };
}

function parseLine(line: string, lineNo: number, sentAt: Date, keywords: Keyword[]): ParsedLine {
  let words = line.split(/\s+/);
  let spentOn = wibDate(sentAt);
  const yesterday = YESTERDAY_WORDS.has(words[0].toLowerCase());
  if (yesterday) {
    words = words.slice(1);
    spentOn = addDays(spentOn, -1);
  }

  let tag: string | null = null;
  let amount: number | null = null;
  const rest: string[] = [];
  for (const word of words) {
    const tagMatch = TAG.exec(word);
    if (tagMatch) {
      tag = tagMatch[1];
      continue;
    }
    if (amount === null) {
      amount = parseAmount(word);
      if (amount !== null) continue;
    }
    rest.push(word);
  }

  if (amount === null) return { ok: false, lineNo, line, reason: "no_amount" };
  let description = rest.join(" ");
  if (description === "") return { ok: false, lineNo, line, reason: "no_description" };
  if (!yesterday && description.toLowerCase() === "makan") description = mealLabel(wibHour(sentAt));

  const category = tag ? capitalize(tag) : (matchCategory(description, keywords) ?? "Lainnya");
  return { ok: true, lineNo, amount, description, category, spentOn, tagged: tag !== null };
}

function mealLabel(hour: number): string {
  if (hour >= 4 && hour < 11) return "makan pagi";
  if (hour >= 11 && hour < 15) return "makan siang";
  if (hour >= 15 && hour < 18) return "makan sore";
  return "makan malam";
}

function matchCategory(description: string, keywords: Keyword[]): string | null {
  const padded = ` ${description.toLowerCase().split(/\s+/).join(" ")} `;
  let best: Keyword | null = null;
  for (const entry of keywords) {
    if (padded.includes(` ${entry.keyword} `) && (!best || entry.keyword.length > best.keyword.length)) {
      best = entry;
    }
  }
  return best?.category ?? null;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
```

Note: in the loop, once `amount` is set, later numeric tokens fall through to `rest` (the "beli 2 tiket 3" test).

- [ ] **Step 4: Run tests**

Run: `pnpm test test/parser.test.ts test/parser-amount.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit** (commit only if authorized)

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/parser.ts test/parser.test.ts
git commit -m "feat(parser): parse expense lines, meal times, tags and commands"
```

---

### Task 5: Crypto helpers and database layer

**Files:**
- Create: `src/crypto.ts`, `src/db.ts`
- Test: `test/crypto.test.ts`, `test/db.test.ts`

**Interfaces:**
- Consumes: `ParsedExpense`, `Keyword` (Task 4); `DateRange` (Task 2).
- Produces:

```ts
// crypto.ts
export function hmacSign(secret: string, data: string): Promise<string>;           // lowercase hex
export function hmacVerify(secret: string, data: string, signatureHex: string): Promise<boolean>;
export function randomToken(): string;                                               // 64 hex chars

// db.ts
export type Expense = { id: number; amount: number; description: string; category: string; spent_on: string };
export type CategoryTotal = { category: string; total: number };
export type DailyTotal = { spent_on: string; total: number };
export type MessageMeta = { waMessageId: string; now: Date };
export type ExpenseUpdate = { amount: number; description: string; category: string; spentOn: string };
export function isProcessed(db: D1Database, waMessageId: string): Promise<boolean>;
export function getKeywords(db: D1Database): Promise<Keyword[]>;
export function upsertKeyword(db: D1Database, keyword: string, category: string): Promise<void>;
export function deleteKeyword(db: D1Database, keyword: string): Promise<void>;
export function listCategories(db: D1Database): Promise<string[]>;
export function saveExpenses(db: D1Database, expenses: ParsedExpense[], meta: MessageMeta & { sender: string }): Promise<void>;
export function undoLastMessage(db: D1Database, meta: MessageMeta): Promise<Expense[]>;
export function totalForRange(db: D1Database, range: DateRange): Promise<number>;
export function categoryTotals(db: D1Database, range: DateRange): Promise<CategoryTotal[]>;
export function dailyTotals(db: D1Database, range: DateRange): Promise<DailyTotal[]>;
export function listExpenses(db: D1Database, range: DateRange, category: string | null): Promise<Expense[]>;
export function updateExpense(db: D1Database, id: number, update: ExpenseUpdate): Promise<void>;
export function deleteExpense(db: D1Database, id: number): Promise<void>;
export function createLoginToken(db: D1Database, meta: MessageMeta): Promise<string>;
export function consumeLoginToken(db: D1Database, token: string, now: Date): Promise<boolean>;
```

- [ ] **Step 1: Write failing tests**

`test/crypto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hmacSign, hmacVerify, randomToken } from "../src/crypto";

describe("crypto", () => {
  it("signs and verifies HMAC-SHA256 as hex", async () => {
    const signature = await hmacSign("secret", "payload");
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(await hmacVerify("secret", "payload", signature)).toBe(true);
    expect(await hmacVerify("secret", "payload!", signature)).toBe(false);
    expect(await hmacVerify("other", "payload", signature)).toBe(false);
    expect(await hmacVerify("secret", "payload", "zz")).toBe(false);
  });

  it("creates distinct 32-byte hex tokens", () => {
    const token = randomToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(randomToken()).not.toBe(token);
  });
});
```

`test/db.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  categoryTotals,
  consumeLoginToken,
  createLoginToken,
  dailyTotals,
  deleteExpense,
  deleteKeyword,
  getKeywords,
  isProcessed,
  listCategories,
  listExpenses,
  saveExpenses,
  totalForRange,
  undoLastMessage,
  updateExpense,
  upsertKeyword,
} from "../src/db";
import type { ParsedExpense } from "../src/parser";

const db = env.DB;
const NOW = new Date("2026-10-01T05:00:00Z");
const OCT = { from: "2026-10-01", to: "2026-10-31" };

function expense(overrides: Partial<ParsedExpense>): ParsedExpense {
  return {
    ok: true,
    lineNo: 1,
    amount: 10_000,
    description: "x",
    category: "Lainnya",
    spentOn: "2026-10-01",
    tagged: false,
    ...overrides,
  };
}

async function save(waMessageId: string, expenses: ParsedExpense[]) {
  await saveExpenses(db, expenses, { waMessageId, now: NOW, sender: "6281200000000" });
}

describe("db", () => {
  it("saves expenses and marks the message processed in one batch", async () => {
    await save("m1", [
      expense({ lineNo: 1, amount: 50_000, description: "bensin", category: "Transport" }),
      expense({ lineNo: 2, amount: 20_000, description: "makan siang", category: "Makan" }),
    ]);
    expect(await isProcessed(db, "m1")).toBe(true);
    expect(await isProcessed(db, "m2")).toBe(false);
    expect(await totalForRange(db, OCT)).toBe(70_000);
  });

  it("upserts keywords for tagged expenses", async () => {
    await save("m1", [expense({ description: "Kopi Susu", category: "Jajan", tagged: true })]);
    const keywords = await getKeywords(db);
    expect(keywords).toContainEqual({ keyword: "kopi susu", category: "Jajan" });
  });

  it("undoes every expense of the most recent message", async () => {
    await save("m1", [expense({ description: "a" })]);
    await save("m2", [expense({ lineNo: 1, description: "b" }), expense({ lineNo: 2, description: "c" })]);

    const deleted = await undoLastMessage(db, { waMessageId: "undo1", now: NOW });

    expect(deleted.map((e) => e.description)).toEqual(["b", "c"]);
    expect((await listExpenses(db, OCT, null)).map((e) => e.description)).toEqual(["a"]);
    expect(await isProcessed(db, "undo1")).toBe(true);
  });

  it("returns nothing to undo on an empty table", async () => {
    expect(await undoLastMessage(db, { waMessageId: "undo1", now: NOW })).toEqual([]);
  });

  it("sums per category and per day within the range", async () => {
    await save("m1", [
      expense({ lineNo: 1, amount: 50_000, category: "Transport", spentOn: "2026-10-01" }),
      expense({ lineNo: 2, amount: 20_000, category: "Makan", spentOn: "2026-10-01" }),
      expense({ lineNo: 3, amount: 30_000, category: "Makan", spentOn: "2026-10-03" }),
      expense({ lineNo: 4, amount: 99_000, category: "Makan", spentOn: "2026-09-30" }),
    ]);
    expect(await categoryTotals(db, OCT)).toEqual([
      { category: "Makan", total: 50_000 },
      { category: "Transport", total: 50_000 },
    ]);
    expect(await dailyTotals(db, OCT)).toEqual([
      { spent_on: "2026-10-01", total: 70_000 },
      { spent_on: "2026-10-03", total: 30_000 },
    ]);
    expect(await totalForRange(db, { from: "2026-11-01", to: "2026-11-30" })).toBe(0);
  });

  it("lists expenses newest first, optionally by category", async () => {
    await save("m1", [
      expense({ lineNo: 1, description: "old", category: "Makan", spentOn: "2026-10-01" }),
      expense({ lineNo: 2, description: "new", category: "Makan", spentOn: "2026-10-05" }),
      expense({ lineNo: 3, description: "fuel", category: "Transport", spentOn: "2026-10-03" }),
    ]);
    expect((await listExpenses(db, OCT, null)).map((e) => e.description)).toEqual(["new", "fuel", "old"]);
    expect((await listExpenses(db, OCT, "Makan")).map((e) => e.description)).toEqual(["new", "old"]);
  });

  it("updates and deletes an expense", async () => {
    await save("m1", [expense({ description: "salah" })]);
    const [row] = await listExpenses(db, OCT, null);

    await updateExpense(db, row.id, { amount: 12_000, description: "benar", category: "Makan", spentOn: "2026-10-02" });
    expect(await listExpenses(db, OCT, null)).toEqual([
      { id: row.id, amount: 12_000, description: "benar", category: "Makan", spent_on: "2026-10-02" },
    ]);

    await deleteExpense(db, row.id);
    expect(await listExpenses(db, OCT, null)).toEqual([]);
  });

  it("manages keywords and lists known categories", async () => {
    await upsertKeyword(db, "Netflix", "Hiburan");
    expect(await getKeywords(db)).toContainEqual({ keyword: "netflix", category: "Hiburan" });
    await upsertKeyword(db, "netflix", "Langganan");
    expect(await getKeywords(db)).toContainEqual({ keyword: "netflix", category: "Langganan" });

    await save("m1", [expense({ category: "Hadiah" })]);
    const categories = await listCategories(db);
    expect(categories).toEqual(expect.arrayContaining(["Hadiah", "Langganan", "Lainnya", "Makan", "Transport"]));
    expect(new Set(categories).size).toBe(categories.length);

    await deleteKeyword(db, "netflix");
    expect((await getKeywords(db)).some((k) => k.keyword === "netflix")).toBe(false);
  });

  it("consumes a login token once and only before it expires", async () => {
    const token = await createLoginToken(db, { waMessageId: "dash1", now: NOW });
    expect(await isProcessed(db, "dash1")).toBe(true);

    expect(await consumeLoginToken(db, "nope", NOW)).toBe(false);
    expect(await consumeLoginToken(db, token, NOW)).toBe(true);
    expect(await consumeLoginToken(db, token, NOW)).toBe(false);

    const expiring = await createLoginToken(db, { waMessageId: "dash2", now: NOW });
    const elevenMinutesLater = new Date(NOW.getTime() + 11 * 60 * 1000);
    expect(await consumeLoginToken(db, expiring, elevenMinutesLater)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/crypto.test.ts test/db.test.ts`
Expected: FAIL — cannot resolve `../src/crypto` / `../src/db`.

- [ ] **Step 3: Implement**

`src/crypto.ts`:

```ts
const encoder = new TextEncoder();

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  return new Uint8Array((hex.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16)));
}

export async function hmacSign(secret: string, data: string): Promise<string> {
  return toHex(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(data)));
}

export async function hmacVerify(secret: string, data: string, signatureHex: string): Promise<boolean> {
  return crypto.subtle.verify("HMAC", await hmacKey(secret), fromHex(signatureHex), encoder.encode(data));
}

export function randomToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
}
```

`src/db.ts`:

```ts
import { randomToken } from "./crypto";
import type { Keyword, ParsedExpense } from "./parser";
import type { DateRange } from "./time";

export type Expense = { id: number; amount: number; description: string; category: string; spent_on: string };
export type CategoryTotal = { category: string; total: number };
export type DailyTotal = { spent_on: string; total: number };
export type MessageMeta = { waMessageId: string; now: Date };
export type ExpenseUpdate = { amount: number; description: string; category: string; spentOn: string };

const EXPENSE_COLUMNS = "id, amount, description, category, spent_on";
const LOGIN_TOKEN_TTL_MS = 10 * 60 * 1000;

function markProcessed(db: D1Database, meta: MessageMeta): D1PreparedStatement {
  return db
    .prepare("INSERT INTO processed_messages (wa_message_id, processed_at) VALUES (?, ?)")
    .bind(meta.waMessageId, meta.now.toISOString());
}

function upsertKeywordStatement(db: D1Database, keyword: string, category: string): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO category_keywords (keyword, category) VALUES (?, ?) ON CONFLICT (keyword) DO UPDATE SET category = excluded.category",
    )
    .bind(keyword.toLowerCase(), category);
}

export async function isProcessed(db: D1Database, waMessageId: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 FROM processed_messages WHERE wa_message_id = ?").bind(waMessageId).first();
  return row !== null;
}

export async function getKeywords(db: D1Database): Promise<Keyword[]> {
  const { results } = await db
    .prepare("SELECT keyword, category FROM category_keywords ORDER BY category, keyword")
    .all<Keyword>();
  return results;
}

export async function upsertKeyword(db: D1Database, keyword: string, category: string): Promise<void> {
  await upsertKeywordStatement(db, keyword, category).run();
}

export async function deleteKeyword(db: D1Database, keyword: string): Promise<void> {
  await db.prepare("DELETE FROM category_keywords WHERE keyword = ?").bind(keyword).run();
}

export async function listCategories(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(
      "SELECT category FROM category_keywords UNION SELECT category FROM expenses UNION SELECT 'Lainnya' ORDER BY category",
    )
    .all<{ category: string }>();
  return results.map((row) => row.category);
}

export async function saveExpenses(
  db: D1Database,
  expenses: ParsedExpense[],
  meta: MessageMeta & { sender: string },
): Promise<void> {
  const inserts = expenses.map((expense) =>
    db
      .prepare(
        "INSERT INTO expenses (amount, description, category, spent_on, sender, wa_message_id, line_no, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        expense.amount,
        expense.description,
        expense.category,
        expense.spentOn,
        meta.sender,
        meta.waMessageId,
        expense.lineNo,
        meta.now.toISOString(),
      ),
  );
  const keywords = expenses
    .filter((expense) => expense.tagged)
    .map((expense) => upsertKeywordStatement(db, expense.description, expense.category));
  await db.batch([...inserts, ...keywords, markProcessed(db, meta)]);
}

export async function undoLastMessage(db: D1Database, meta: MessageMeta): Promise<Expense[]> {
  const last = await db
    .prepare("SELECT wa_message_id FROM expenses ORDER BY id DESC LIMIT 1")
    .first<{ wa_message_id: string }>();
  if (!last) return [];

  const { results } = await db
    .prepare(`SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE wa_message_id = ? ORDER BY line_no`)
    .bind(last.wa_message_id)
    .all<Expense>();
  await db.batch([
    db.prepare("DELETE FROM expenses WHERE wa_message_id = ?").bind(last.wa_message_id),
    markProcessed(db, meta),
  ]);
  return results;
}

export async function totalForRange(db: D1Database, range: DateRange): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE spent_on BETWEEN ? AND ?")
    .bind(range.from, range.to)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function categoryTotals(db: D1Database, range: DateRange): Promise<CategoryTotal[]> {
  const { results } = await db
    .prepare(
      "SELECT category, SUM(amount) AS total FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY category ORDER BY total DESC, category",
    )
    .bind(range.from, range.to)
    .all<CategoryTotal>();
  return results;
}

export async function dailyTotals(db: D1Database, range: DateRange): Promise<DailyTotal[]> {
  const { results } = await db
    .prepare(
      "SELECT spent_on, SUM(amount) AS total FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY spent_on ORDER BY spent_on",
    )
    .bind(range.from, range.to)
    .all<DailyTotal>();
  return results;
}

export async function listExpenses(db: D1Database, range: DateRange, category: string | null): Promise<Expense[]> {
  const statement = category
    ? db
        .prepare(
          `SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE spent_on BETWEEN ? AND ? AND category = ? ORDER BY spent_on DESC, id DESC`,
        )
        .bind(range.from, range.to, category)
    : db
        .prepare(`SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE spent_on BETWEEN ? AND ? ORDER BY spent_on DESC, id DESC`)
        .bind(range.from, range.to);
  const { results } = await statement.all<Expense>();
  return results;
}

export async function updateExpense(db: D1Database, id: number, update: ExpenseUpdate): Promise<void> {
  await db
    .prepare("UPDATE expenses SET amount = ?, description = ?, category = ?, spent_on = ? WHERE id = ?")
    .bind(update.amount, update.description, update.category, update.spentOn, id)
    .run();
}

export async function deleteExpense(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM expenses WHERE id = ?").bind(id).run();
}

export async function createLoginToken(db: D1Database, meta: MessageMeta): Promise<string> {
  const token = randomToken();
  const expiresAt = new Date(meta.now.getTime() + LOGIN_TOKEN_TTL_MS).toISOString();
  await db.batch([
    db.prepare("INSERT INTO login_tokens (token, expires_at) VALUES (?, ?)").bind(token, expiresAt),
    markProcessed(db, meta),
  ]);
  return token;
}

export async function consumeLoginToken(db: D1Database, token: string, now: Date): Promise<boolean> {
  const result = await db
    .prepare("UPDATE login_tokens SET used_at = ? WHERE token = ? AND used_at IS NULL AND expires_at > ?")
    .bind(now.toISOString(), token, now.toISOString())
    .run();
  return result.meta.changes === 1;
}
```

`db.batch` runs as a single D1 transaction, which is what makes the processed-message marker atomic with each write.

- [ ] **Step 4: Run tests**

Run: `pnpm test test/crypto.test.ts test/db.test.ts`
Expected: PASS. If `crypto.subtle` calls fail to typecheck because of `Uint8Array<ArrayBufferLike>` vs `BufferSource`, fix the helper's return types (e.g. `Uint8Array<ArrayBuffer>`), not with casts to `any`.

- [ ] **Step 5: Typecheck, lint, commit** (commit only if authorized)

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/crypto.ts src/db.ts test/crypto.test.ts test/db.test.ts
git commit -m "feat(db): add D1 queries with atomic processed-message markers"
```

---

### Task 6: WhatsApp client and reply texts

**Files:**
- Create: `src/whatsapp.ts`, `src/replies.ts`
- Create: `test/helpers.ts`
- Test: `test/whatsapp.test.ts`, `test/replies.test.ts`

**Interfaces:**
- Consumes: `hmacVerify` (Task 5); `Bindings` (Task 1); `formatRupiah` (Task 2); `ParsedLine`, `isExpense`, `SkippedLine` (Task 4); `CategoryTotal`, `Expense` (Task 5).
- Produces:

```ts
// whatsapp.ts
export type IncomingMessage = { id: string; from: string; sentAt: Date; text: string | null };
export type WebhookPayload = { entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[] };
export function verifySignature(rawBody: string, header: string | undefined, appSecret: string): Promise<boolean>;
export function extractMessages(payload: WebhookPayload): IncomingMessage[];
export function sendText(env: Bindings, to: string, body: string): Promise<void>;

// replies.ts
export const HELP_TEXT: string;
export const NON_TEXT_REPLY: string;
export function expensesReply(lines: ParsedLine[], todayTotal: number): string;
export function summaryReply(title: string, totals: CategoryTotal[]): string;
export function undoReply(deleted: Expense[]): string;
export function loginReply(url: string): string;

// test/helpers.ts
export const OWNER: string;                                  // "6281200000000"
export function textPayload(opts: { id: string; text: string; from?: string; sentAt?: Date }): WebhookPayload;
export function imagePayload(opts: { id: string; from?: string }): WebhookPayload;
export function statusPayload(): WebhookPayload;
export function incoming(opts: { id: string; text: string | null; sentAt?: Date; from?: string }): IncomingMessage;
export function mockFetch(): MockInstance<typeof fetch>;   // resolves every call with 200 "{}"
export function sentBodies(spy: MockInstance<typeof fetch>): string[];   // text.body of each WhatsApp send
```

- [ ] **Step 1: Test helpers**

`test/helpers.ts`:

```ts
import { type MockInstance, vi } from "vitest";
import type { IncomingMessage, WebhookPayload } from "../src/whatsapp";

export const OWNER = "6281200000000";

// 12:00 WIB on Thursday 2026-10-01
export const NOON = new Date("2026-10-01T05:00:00Z");

function unixSeconds(date: Date): string {
  return String(Math.floor(date.getTime() / 1000));
}

function payloadWith(message: Record<string, unknown>): WebhookPayload {
  return {
    entry: [{ changes: [{ value: { messages: [message as never] } }] }],
  };
}

export function textPayload(opts: { id: string; text: string; from?: string; sentAt?: Date }): WebhookPayload {
  return payloadWith({
    id: opts.id,
    from: opts.from ?? OWNER,
    timestamp: unixSeconds(opts.sentAt ?? NOON),
    type: "text",
    text: { body: opts.text },
  });
}

export function imagePayload(opts: { id: string; from?: string }): WebhookPayload {
  return payloadWith({
    id: opts.id,
    from: opts.from ?? OWNER,
    timestamp: unixSeconds(NOON),
    type: "image",
    image: { id: "media-1" },
  });
}

export function statusPayload(): WebhookPayload {
  return { entry: [{ changes: [{ value: {} }] }] };
}

export function incoming(opts: { id: string; text: string | null; sentAt?: Date; from?: string }): IncomingMessage {
  return { id: opts.id, from: opts.from ?? OWNER, sentAt: opts.sentAt ?? NOON, text: opts.text };
}

export function mockFetch(): MockInstance<typeof fetch> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}"));
}

export function sentBodies(spy: MockInstance<typeof fetch>): string[] {
  return spy.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).text.body);
}
```

(The `as never` cast is test-only, to build payloads with fields `WaMessage` does not declare such as `image`.)

- [ ] **Step 2: Write failing tests**

`test/whatsapp.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hmacSign } from "../src/crypto";
import { extractMessages, sendText, verifySignature } from "../src/whatsapp";
import { imagePayload, mockFetch, NOON, OWNER, sentBodies, statusPayload, textPayload } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifySignature", () => {
  it("accepts Meta's sha256= header for the exact body", async () => {
    const body = '{"a":1}';
    const header = `sha256=${await hmacSign("app-secret", body)}`;
    expect(await verifySignature(body, header, "app-secret")).toBe(true);
    expect(await verifySignature(`${body} `, header, "app-secret")).toBe(false);
    expect(await verifySignature(body, header.replace("sha256=", "sha1="), "app-secret")).toBe(false);
    expect(await verifySignature(body, undefined, "app-secret")).toBe(false);
  });
});

describe("extractMessages", () => {
  it("extracts text messages with their WhatsApp timestamp", () => {
    expect(extractMessages(textPayload({ id: "wamid.1", text: "bensin 50" }))).toEqual([
      { id: "wamid.1", from: OWNER, sentAt: NOON, text: "bensin 50" },
    ]);
  });

  it("marks non-text messages with null text", () => {
    expect(extractMessages(imagePayload({ id: "wamid.2" }))[0].text).toBeNull();
  });

  it("returns nothing for status-only events", () => {
    expect(extractMessages(statusPayload())).toEqual([]);
    expect(extractMessages({})).toEqual([]);
  });
});

describe("sendText", () => {
  it("posts a text message to the Graph API without link previews", async () => {
    const fetchSpy = mockFetch();
    await sendText(env, OWNER, "halo");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`https://graph.facebook.com/v23.0/${env.WA_PHONE_NUMBER_ID}/messages`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${env.WA_ACCESS_TOKEN}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: "whatsapp",
      to: OWNER,
      type: "text",
      text: { body: "halo", preview_url: false },
    });
    expect(sentBodies(fetchSpy)).toEqual(["halo"]);
  });

  it("throws when the Graph API rejects the message", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("bad token", { status: 401 }));
    await expect(sendText(env, OWNER, "halo")).rejects.toThrow("WhatsApp send failed: 401 bad token");
  });
});
```

`test/replies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ParsedLine } from "../src/parser";
import { expensesReply, HELP_TEXT, loginReply, summaryReply, undoReply } from "../src/replies";

const bensin: ParsedLine = {
  ok: true,
  lineNo: 1,
  amount: 50_000,
  description: "bensin",
  category: "Transport",
  spentOn: "2026-10-01",
  tagged: false,
};
const makan: ParsedLine = { ...bensin, lineNo: 2, amount: 20_000, description: "makan siang", category: "Makan" };
const skipped: ParsedLine = { ok: false, lineNo: 3, line: "makan siang", reason: "no_amount" };

describe("replies", () => {
  it("confirms a single expense with today's total", () => {
    expect(expensesReply([bensin], 143_000)).toBe("✅ Rp50.000 · bensin · Transport\nHari ini: Rp143.000");
  });

  it("lists multiple expenses and skipped lines", () => {
    expect(expensesReply([bensin, makan, skipped], 70_000)).toBe(
      [
        "✅ 2 dicatat",
        "• Rp50.000 · bensin · Transport",
        "• Rp20.000 · makan siang · Makan",
        '⚠️ Dilewati: "makan siang" (tidak ada nominal)',
        "Hari ini: Rp70.000",
      ].join("\n"),
    );
  });

  it("shows help when nothing was saved", () => {
    expect(expensesReply([skipped], 0)).toBe(`⚠️ Dilewati: "makan siang" (tidak ada nominal)\n\n${HELP_TEXT}`);
    expect(expensesReply([], 0)).toBe(HELP_TEXT);
  });

  it("summarizes totals per category", () => {
    expect(
      summaryReply("Oktober 2026", [
        { category: "Makan", total: 980_000 },
        { category: "Transport", total: 620_000 },
      ]),
    ).toBe("📊 Oktober 2026: Rp1.600.000\n• Makan: Rp980.000\n• Transport: Rp620.000");
    expect(summaryReply("Hari ini", [])).toBe("📊 Hari ini: Rp0\nBelum ada catatan.");
  });

  it("describes undone expenses", () => {
    expect(undoReply([{ id: 1, amount: 18_000, description: "cuci", category: "Laundry", spent_on: "2026-10-01" }])).toBe(
      "🗑️ Dihapus:\n• Rp18.000 · cuci · Laundry",
    );
    expect(undoReply([])).toBe("Belum ada catatan.");
  });

  it("sends the login link", () => {
    expect(loginReply("https://spendchat.test/login?t=abc")).toBe(
      "🔐 Link dashboard (berlaku 10 menit, sekali pakai):\nhttps://spendchat.test/login?t=abc",
    );
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test test/whatsapp.test.ts test/replies.test.ts`
Expected: FAIL — cannot resolve `../src/whatsapp` / `../src/replies`.

- [ ] **Step 4: Implement**

`src/whatsapp.ts`:

```ts
import { hmacVerify } from "./crypto";
import type { Bindings } from "./env";

// Bump to the version shown in the Meta App Dashboard when upgrading.
const GRAPH_API_VERSION = "v23.0";

type WaMessage = { id: string; from: string; timestamp: string; type: string; text?: { body: string } };

export type WebhookPayload = { entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[] };

export type IncomingMessage = { id: string; from: string; sentAt: Date; text: string | null };

export async function verifySignature(rawBody: string, header: string | undefined, appSecret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  return hmacVerify(appSecret, rawBody, header.slice("sha256=".length));
}

export function extractMessages(payload: WebhookPayload): IncomingMessage[] {
  return (payload.entry ?? [])
    .flatMap((entry) => entry.changes ?? [])
    .flatMap((change) => change.value?.messages ?? [])
    .map((message) => ({
      id: message.id,
      from: message.from,
      sentAt: new Date(Number(message.timestamp) * 1000),
      text: message.type === "text" && message.text ? message.text.body : null,
    }));
}

export async function sendText(env: Bindings, to: string, body: string): Promise<void> {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${env.WA_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: false } }),
  });
  if (!response.ok) throw new Error(`WhatsApp send failed: ${response.status} ${await response.text()}`);
}
```

`src/replies.ts`:

```ts
import type { CategoryTotal, Expense } from "./db";
import { formatRupiah } from "./money";
import { isExpense, type ParsedLine, type SkippedLine } from "./parser";

export const HELP_TEXT = [
  "Cara mencatat: tulis keterangan + nominal.",
  "• bensin 50 → Rp50.000",
  "• kopi 18k #jajan → kategori Jajan",
  "• kemarin parkir 5rb → dicatat ke kemarin",
  "Bisa banyak baris sekaligus, satu baris satu pengeluaran.",
  "",
  "Perintah: hari ini · minggu ini · bulan ini · hapus · dashboard · bantuan",
  "English: today · this week · this month · undo · help · yesterday",
].join("\n");

export const NON_TEXT_REPLY = "Aku cuma bisa baca teks 🙏";

const SKIP_REASONS: Record<SkippedLine["reason"], string> = {
  no_amount: "tidak ada nominal",
  no_description: "tidak ada keterangan",
};

function expenseText(expense: { amount: number; description: string; category: string }): string {
  return `${formatRupiah(expense.amount)} · ${expense.description} · ${expense.category}`;
}

export function expensesReply(lines: ParsedLine[], todayTotal: number): string {
  const saved = lines.filter(isExpense);
  const skipped = lines
    .filter((line): line is SkippedLine => !line.ok)
    .map((line) => `⚠️ Dilewati: "${line.line}" (${SKIP_REASONS[line.reason]})`);

  if (saved.length === 0) return skipped.length ? `${skipped.join("\n")}\n\n${HELP_TEXT}` : HELP_TEXT;

  const savedText =
    saved.length === 1
      ? [`✅ ${expenseText(saved[0])}`]
      : [`✅ ${saved.length} dicatat`, ...saved.map((expense) => `• ${expenseText(expense)}`)];
  return [...savedText, ...skipped, `Hari ini: ${formatRupiah(todayTotal)}`].join("\n");
}

export function summaryReply(title: string, totals: CategoryTotal[]): string {
  if (totals.length === 0) return `📊 ${title}: ${formatRupiah(0)}\nBelum ada catatan.`;
  const total = totals.reduce((sum, row) => sum + row.total, 0);
  return [
    `📊 ${title}: ${formatRupiah(total)}`,
    ...totals.map((row) => `• ${row.category}: ${formatRupiah(row.total)}`),
  ].join("\n");
}

export function undoReply(deleted: Expense[]): string {
  if (deleted.length === 0) return "Belum ada catatan.";
  return ["🗑️ Dihapus:", ...deleted.map((expense) => `• ${expenseText(expense)}`)].join("\n");
}

export function loginReply(url: string): string {
  return `🔐 Link dashboard (berlaku 10 menit, sekali pakai):\n${url}`;
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test test/whatsapp.test.ts test/replies.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit** (commit only if authorized)

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/whatsapp.ts src/replies.ts test/helpers.ts test/whatsapp.test.ts test/replies.test.ts
git commit -m "feat(whatsapp): add Cloud API client and reply texts"
```

---

### Task 7: Bot message handling

**Files:**
- Create: `src/bot.ts`
- Test: `test/bot.test.ts`

**Interfaces:**
- Consumes: `parseMessage`, `isExpense` (Task 4); db functions (Task 5); reply builders (Task 6); `dayRange`, `weekRange`, `monthRange`, `wibMonth`, `monthLabel` (Task 2); `IncomingMessage` (Task 6).
- Produces: `handleMessage(env: Bindings, message: IncomingMessage, now: Date): Promise<string>` — applies the message to D1 and returns the reply text. Does not send anything and does not check `isProcessed` or the sender (the route does).

- [ ] **Step 1: Write failing tests**

`test/bot.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { handleMessage } from "../src/bot";
import { getKeywords, isProcessed, listExpenses } from "../src/db";
import { HELP_TEXT, NON_TEXT_REPLY } from "../src/replies";
import { incoming, NOON } from "./helpers";

const OCT = { from: "2026-10-01", to: "2026-10-31" };

function send(id: string, text: string | null, sentAt = NOON) {
  return handleMessage(env, incoming({ id, text, sentAt }), NOON);
}

describe("handleMessage", () => {
  it("records a multi-line message and replies with today's total", async () => {
    const reply = await send("m1", "bensin 50\nmakan 20\nmakan siang");

    expect(reply).toBe(
      [
        "✅ 2 dicatat",
        "• Rp50.000 · bensin · Transport",
        "• Rp20.000 · makan siang · Makan",
        '⚠️ Dilewati: "makan siang" (tidak ada nominal)',
        "Hari ini: Rp70.000",
      ].join("\n"),
    );
    expect((await listExpenses(env.DB, OCT, null)).map((e) => e.description)).toEqual(["makan siang", "bensin"]);
    expect(await isProcessed(env.DB, "m1")).toBe(true);
  });

  it("does not mark a message processed when nothing was saved", async () => {
    expect(await send("m1", "halo")).toContain(HELP_TEXT);
    expect(await isProcessed(env.DB, "m1")).toBe(false);
  });

  it("remembers a #tag for the description", async () => {
    await send("m1", "kopi 18k #jajan");
    expect(await getKeywords(env.DB)).toContainEqual({ keyword: "kopi", category: "Jajan" });
    expect(await send("m2", "kopi 20")).toBe("✅ Rp20.000 · kopi · Jajan\nHari ini: Rp38.000");
  });

  it("excludes yesterday's entries from today's total", async () => {
    expect(await send("m1", "kemarin parkir 5")).toBe("✅ Rp5.000 · parkir · Transport\nHari ini: Rp0");
  });

  it("summarizes today, this week and this month", async () => {
    await send("m1", "bensin 50\nmakan 20");
    await send("m2", "kemarin cuci 18");
    await send("m3", "buku 100", new Date("2026-09-15T05:00:00Z"));

    expect(await send("c1", "hari ini")).toBe("📊 Hari ini: Rp70.000\n• Transport: Rp50.000\n• Makan: Rp20.000");
    expect(await send("c2", "minggu ini")).toBe(
      "📊 Minggu ini: Rp88.000\n• Transport: Rp50.000\n• Makan: Rp20.000\n• Laundry: Rp18.000",
    );
    expect(await send("c3", "bulan ini")).toBe("📊 Oktober 2026: Rp70.000\n• Transport: Rp50.000\n• Makan: Rp20.000");
  });

  it("undoes the whole last message", async () => {
    await send("m1", "buku 45");
    await send("m2", "bensin 50\ncuci 18");

    expect(await send("u1", "hapus")).toBe("🗑️ Dihapus:\n• Rp50.000 · bensin · Transport\n• Rp18.000 · cuci · Laundry");
    expect((await listExpenses(env.DB, OCT, null)).map((e) => e.description)).toEqual(["buku"]);
  });

  it("creates a login link", async () => {
    const reply = await send("d1", "dashboard");
    expect(reply).toMatch(/^🔐 Link dashboard \(berlaku 10 menit, sekali pakai\):\nhttps:\/\/spendchat\.test\/login\?t=[0-9a-f]{64}$/);
    expect(await isProcessed(env.DB, "d1")).toBe(true);
  });

  it("answers help and non-text messages", async () => {
    expect(await send("h1", "bantuan")).toBe(HELP_TEXT);
    expect(await send("i1", null)).toBe(NON_TEXT_REPLY);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/bot.test.ts`
Expected: FAIL — cannot resolve `../src/bot`.

- [ ] **Step 3: Implement**

`src/bot.ts`:

```ts
import { categoryTotals, createLoginToken, getKeywords, saveExpenses, totalForRange, undoLastMessage } from "./db";
import type { Bindings } from "./env";
import { isExpense, parseMessage } from "./parser";
import { expensesReply, HELP_TEXT, loginReply, NON_TEXT_REPLY, summaryReply, undoReply } from "./replies";
import { dayRange, monthLabel, monthRange, weekRange, wibMonth } from "./time";
import type { IncomingMessage } from "./whatsapp";

export async function handleMessage(env: Bindings, message: IncomingMessage, now: Date): Promise<string> {
  if (message.text === null) return NON_TEXT_REPLY;

  const db = env.DB;
  const meta = { waMessageId: message.id, now };
  const parsed = parseMessage(message.text, message.sentAt, await getKeywords(db));

  if (parsed.kind === "expenses") {
    const expenses = parsed.lines.filter(isExpense);
    if (expenses.length > 0) await saveExpenses(db, expenses, { ...meta, sender: message.from });
    return expensesReply(parsed.lines, await totalForRange(db, dayRange(message.sentAt)));
  }

  switch (parsed.command) {
    case "today":
      return summaryReply("Hari ini", await categoryTotals(db, dayRange(message.sentAt)));
    case "week":
      return summaryReply("Minggu ini", await categoryTotals(db, weekRange(message.sentAt)));
    case "month": {
      const month = wibMonth(message.sentAt);
      return summaryReply(monthLabel(month), await categoryTotals(db, monthRange(month)));
    }
    case "undo":
      return undoReply(await undoLastMessage(db, meta));
    case "dashboard": {
      const token = await createLoginToken(db, meta);
      return loginReply(`${env.BASE_URL}/login?t=${token}`);
    }
    case "help":
      return HELP_TEXT;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test test/bot.test.ts`
Expected: PASS. (Category order with equal totals follows `ORDER BY total DESC, category`.)

- [ ] **Step 5: Typecheck, lint, commit** (commit only if authorized)

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/bot.ts test/bot.test.ts
git commit -m "feat(bot): handle expense messages and chat commands"
```

---

### Task 8: Webhook route

**Files:**
- Create: `src/routes/webhook.ts`
- Modify: `src/index.ts`
- Modify: `test/helpers.ts` (add `postWebhook`)
- Test: `test/webhook.test.ts`

**Interfaces:**
- Consumes: `verifySignature`, `extractMessages`, `sendText` (Task 6); `handleMessage` (Task 7); `isProcessed` (Task 5); `hmacSign` (Task 5).
- Produces: `webhook` Hono sub-app mounted at `/webhook`; test helper `postWebhook(payload: unknown, secret?: string): Promise<Response>`.

- [ ] **Step 1: Add the request helper** — append to `test/helpers.ts`:

```ts
import { env } from "cloudflare:workers";
import app from "../src/index";
import { hmacSign } from "../src/crypto";

export async function postWebhook(payload: unknown, secret = env.WA_APP_SECRET): Promise<Response> {
  const body = JSON.stringify(payload);
  return app.request(
    "/webhook",
    {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${await hmacSign(secret, body)}` },
    },
    env,
  );
}
```

(Move the new imports to the top of the file with the existing ones.)

- [ ] **Step 2: Write failing tests**

`test/webhook.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { listExpenses } from "../src/db";
import app from "../src/index";
import { NON_TEXT_REPLY } from "../src/replies";
import { imagePayload, mockFetch, postWebhook, sentBodies, statusPayload, textPayload } from "./helpers";

const OCT = { from: "2026-10-01", to: "2026-10-31" };
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = mockFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /webhook", () => {
  it("echoes the challenge for the right verify token", async () => {
    const ok = await app.request(
      "/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345",
      {},
      env,
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");

    const bad = await app.request("/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345", {}, env);
    expect(bad.status).toBe(403);
  });
});

describe("POST /webhook", () => {
  it("records the owner's expenses and replies", async () => {
    const response = await postWebhook(textPayload({ id: "wamid.1", text: "bensin 50\nmakan 20" }));

    expect(response.status).toBe(200);
    expect(await listExpenses(env.DB, OCT, null)).toHaveLength(2);
    expect(sentBodies(fetchSpy)).toEqual([
      "✅ 2 dicatat\n• Rp50.000 · bensin · Transport\n• Rp20.000 · makan siang · Makan\nHari ini: Rp70.000",
    ]);
  });

  it("rejects an invalid signature", async () => {
    const response = await postWebhook(textPayload({ id: "wamid.1", text: "bensin 50" }), "wrong-secret");
    expect(response.status).toBe(401);
    expect(await listExpenses(env.DB, OCT, null)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores messages from other numbers", async () => {
    const response = await postWebhook(textPayload({ id: "wamid.1", text: "bensin 50", from: "6289999999999" }));
    expect(response.status).toBe(200);
    expect(await listExpenses(env.DB, OCT, null)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("acknowledges status-only events", async () => {
    expect((await postWebhook(statusPayload())).status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not reprocess a retried delivery", async () => {
    const payload = textPayload({ id: "wamid.1", text: "bensin 50" });
    await postWebhook(payload);
    await postWebhook(payload);

    expect(await listExpenses(env.DB, OCT, null)).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not undo twice when 'hapus' is retried", async () => {
    await postWebhook(textPayload({ id: "wamid.1", text: "buku 45" }));
    await postWebhook(textPayload({ id: "wamid.2", text: "bensin 50\ncuci 18" }));
    const undo = textPayload({ id: "wamid.3", text: "hapus" });
    await postWebhook(undo);
    await postWebhook(undo);

    expect((await listExpenses(env.DB, OCT, null)).map((e) => e.description)).toEqual(["buku"]);
  });

  it("replies to non-text messages", async () => {
    await postWebhook(imagePayload({ id: "wamid.1" }));
    expect(sentBodies(fetchSpy)).toEqual([NON_TEXT_REPLY]);
  });

  it("fails the request when the reply cannot be sent, keeping the saved data", async () => {
    fetchSpy.mockImplementation(async () => new Response("down", { status: 500 }));
    const response = await postWebhook(textPayload({ id: "wamid.1", text: "bensin 50" }));
    expect(response.status).toBe(500);
    expect(await listExpenses(env.DB, OCT, null)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test test/webhook.test.ts`
Expected: FAIL — 404s, because `/webhook` is not mounted.

- [ ] **Step 4: Implement**

`src/routes/webhook.ts`:

```ts
import { Hono } from "hono";
import { handleMessage } from "../bot";
import { isProcessed } from "../db";
import type { AppEnv } from "../env";
import { extractMessages, sendText, verifySignature, type WebhookPayload } from "../whatsapp";

export const webhook = new Hono<AppEnv>();

webhook.get("/", (c) => {
  const challenge = c.req.query("hub.challenge");
  if (c.req.query("hub.mode") === "subscribe" && c.req.query("hub.verify_token") === c.env.WA_VERIFY_TOKEN && challenge) {
    return c.text(challenge);
  }
  return c.text("Forbidden", 403);
});

webhook.post("/", async (c) => {
  const rawBody = await c.req.text();
  if (!(await verifySignature(rawBody, c.req.header("X-Hub-Signature-256"), c.env.WA_APP_SECRET))) {
    return c.text("Invalid signature", 401);
  }

  for (const message of extractMessages(JSON.parse(rawBody) as WebhookPayload)) {
    if (message.from !== c.env.OWNER_WA_NUMBER) continue;
    if (await isProcessed(c.env.DB, message.id)) continue;
    const reply = await handleMessage(c.env, message, new Date());
    await sendText(c.env, message.from, reply);
  }
  return c.text("OK");
});
```

`src/index.ts`:

```ts
import { Hono } from "hono";
import type { AppEnv } from "./env";
import { webhook } from "./routes/webhook";

const app = new Hono<AppEnv>();

app.route("/webhook", webhook);

export default app;
```

- [ ] **Step 5: Run tests**

Run: `pnpm test test/webhook.test.ts`
Expected: PASS. The last test relies on Hono turning the thrown `sendText` error into a 500 response.

- [ ] **Step 6: Full suite, typecheck, lint, commit** (commit only if authorized)

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add src/routes/webhook.ts src/index.ts test/helpers.ts test/webhook.test.ts
git commit -m "feat(webhook): verify Meta webhooks and reply to the owner's messages"
```

---

### Task 9: Magic-link login, session cookie, layout

**Files:**
- Create: `src/auth.ts`, `src/routes/login.tsx`, `src/views/styles.ts`, `src/views/layout.tsx`, `src/views/login.tsx`
- Modify: `src/index.ts`, `test/helpers.ts` (add `sessionCookie`)
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: `hmacSign`, `hmacVerify` (Task 5); `createLoginToken`, `consumeLoginToken` (Task 5).
- Produces:

```ts
// auth.ts
export const SESSION_COOKIE = "session";
export function createSession(secret: string, now: Date): Promise<string>;
export function isValidSession(secret: string, value: string, now: Date): Promise<boolean>;
export function setSessionCookie(c: Context<AppEnv>, value: string): void;
export const requireSession: MiddlewareHandler<AppEnv>;

// views/layout.tsx
export function Layout(props: { title: string; children: Child }): JSX.Element;

// test/helpers.ts
export function sessionCookie(): Promise<string>;   // "session=<value>"
```

- `index.ts` guards `/dashboard`, `/expenses/*`, `/categories`, `/categories/*` with `requireSession`, and `GET /` redirects to `/dashboard`.

- [ ] **Step 1: Add the session helper** — append to `test/helpers.ts` (imports at the top):

```ts
import { createSession, SESSION_COOKIE } from "../src/auth";

export async function sessionCookie(): Promise<string> {
  return `${SESSION_COOKIE}=${await createSession(env.SESSION_SECRET, new Date())}`;
}
```

- [ ] **Step 2: Write failing tests**

`test/auth.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createSession, isValidSession } from "../src/auth";
import { createLoginToken } from "../src/db";
import app from "../src/index";
import { sessionCookie } from "./helpers";

const NOW = new Date("2026-10-01T05:00:00Z");

async function newToken(now = new Date()) {
  return createLoginToken(env.DB, { waMessageId: crypto.randomUUID(), now });
}

function postLogin(token: string) {
  return app.request(
    "/login",
    { method: "POST", body: new URLSearchParams({ token }), headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    env,
  );
}

describe("sessions", () => {
  it("accepts a fresh signed session and rejects tampered or expired ones", async () => {
    const value = await createSession("secret", NOW);
    expect(await isValidSession("secret", value, NOW)).toBe(true);
    expect(await isValidSession("other", value, NOW)).toBe(false);
    expect(await isValidSession("secret", `9${value}`, NOW)).toBe(false);
    expect(await isValidSession("secret", "garbage", NOW)).toBe(false);

    const thirtyOneDaysLater = new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(await isValidSession("secret", value, thirtyOneDaysLater)).toBe(false);
  });
});

describe("login flow", () => {
  it("shows a confirm button without consuming the token on GET", async () => {
    const token = await newToken();
    const page = await app.request(`/login?t=${token}`, {}, env);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`value="${token}"`);
    expect(html).toContain("Masuk");

    expect((await postLogin(token)).status).toBe(302);
  });

  it("sets a session cookie and redirects on POST with a valid token", async () => {
    const response = await postLogin(await newToken());
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/dashboard");
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^session=\d+\.[0-9a-f]{64};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("rejects reused, expired and unknown tokens", async () => {
    const token = await newToken();
    await postLogin(token);
    expect((await postLogin(token)).status).toBe(401);

    const expired = await newToken(new Date(Date.now() - 11 * 60 * 1000));
    expect((await postLogin(expired)).status).toBe(401);

    const unknown = await postLogin("nope");
    expect(unknown.status).toBe(401);
    expect(await unknown.text()).toContain("Link sudah kedaluwarsa atau sudah dipakai");
  });

  it("explains how to log in when no token is given", async () => {
    expect(await (await app.request("/login", {}, env)).text()).toContain("Ketik <b>dashboard</b> di WhatsApp");
  });
});

describe("requireSession", () => {
  it("redirects protected pages to /login without a valid session", async () => {
    for (const path of ["/dashboard", "/categories"]) {
      const response = await app.request(path, {}, env);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/login");
    }
    const forged = await app.request("/dashboard", { headers: { Cookie: "session=123.abc" } }, env);
    expect(forged.status).toBe(302);
  });

  it("lets a valid session through", async () => {
    const response = await app.request("/dashboard", { headers: { Cookie: await sessionCookie() } }, env);
    expect(response.status).not.toBe(302);
  });

  it("redirects the root to the dashboard", async () => {
    const response = await app.request("/", {}, env);
    expect(response.headers.get("Location")).toBe("/dashboard");
  });
});
```

(The "lets a valid session through" test expects 404 until Task 10 adds the page; `not.toBe(302)` holds either way.)

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test test/auth.test.ts`
Expected: FAIL — cannot resolve `../src/auth`.

- [ ] **Step 4: Implement auth**

`src/auth.ts`:

```ts
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { hmacSign, hmacVerify } from "./crypto";
import type { AppEnv } from "./env";

export const SESSION_COOKIE = "session";
const SESSION_TTL_S = 30 * 24 * 60 * 60;

function sessionPayload(expiresAt: string): string {
  return `session:${expiresAt}`;
}

export async function createSession(secret: string, now: Date): Promise<string> {
  const expiresAt = String(now.getTime() + SESSION_TTL_S * 1000);
  return `${expiresAt}.${await hmacSign(secret, sessionPayload(expiresAt))}`;
}

export async function isValidSession(secret: string, value: string, now: Date): Promise<boolean> {
  const [expiresAt, signature] = value.split(".");
  if (!signature || !(Number(expiresAt) > now.getTime())) return false;
  return hmacVerify(secret, sessionPayload(expiresAt), signature);
}

export function setSessionCookie(c: Context<AppEnv>, value: string): void {
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
}

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const value = getCookie(c, SESSION_COOKIE);
  if (!value || !(await isValidSession(c.env.SESSION_SECRET, value, new Date()))) return c.redirect("/login");
  await next();
};
```

- [ ] **Step 5: Implement styles and layout**

`src/views/styles.ts` (colors from the dataviz reference palette; single-hue blue bars):

```ts
export const CSS = `
:root {
  color-scheme: light;
  --page: #f9f9f7;
  --surface: #fcfcfb;
  --ink: #0b0b0b;
  --ink-2: #52514e;
  --muted: #898781;
  --grid: #e1e0d9;
  --border: rgba(11, 11, 11, 0.1);
  --bar: #2a78d6;
  --danger: #d03b3b;
  --up: #006300;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --page: #0d0d0d;
    --surface: #1a1a19;
    --ink: #ffffff;
    --ink-2: #c3c2b7;
    --muted: #898781;
    --grid: #2c2c2a;
    --border: rgba(255, 255, 255, 0.1);
    --bar: #3987e5;
    --danger: #e66767;
    --up: #0ca30c;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--page);
  color: var(--ink);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 720px; margin: 0 auto; padding: 16px; }
a { color: var(--bar); }
nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 16px; }
nav h1 { font-size: 18px; margin: 0; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.muted { color: var(--muted); }
.secondary { color: var(--ink-2); }
.hero { font-size: 32px; font-weight: 700; margin: 4px 0; }
.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.num { font-variant-numeric: tabular-nums; }
.up { color: var(--danger); }
.down { color: var(--up); }
.daily { display: flex; align-items: flex-end; gap: 2px; height: 120px; border-bottom: 1px solid var(--grid); }
.day { position: relative; flex: 1; height: 100%; display: flex; align-items: flex-end; outline: none; }
.day .bar { width: 100%; background: var(--bar); border-radius: 4px 4px 0 0; min-height: 0; }
.day:hover::after, .day:focus::after {
  content: attr(data-tip);
  position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%);
  background: var(--ink); color: var(--page); padding: 2px 6px; border-radius: 6px;
  font-size: 12px; white-space: nowrap; z-index: 1;
}
.axis { display: flex; justify-content: space-between; font-size: 12px; margin-top: 4px; }
.cats { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.cats a { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; color: inherit; text-decoration: none; }
.cats .track { grid-column: 1 / -1; height: 8px; background: var(--grid); border-radius: 4px; overflow: hidden; }
.cats .fill { display: block; height: 100%; background: var(--bar); border-radius: 4px; }
.cats a[aria-current="true"] .cat-name { font-weight: 700; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 4px; border-bottom: 1px solid var(--grid); vertical-align: top; }
td.amount, th.amount { text-align: right; }
details summary { cursor: pointer; color: var(--bar); font-size: 13px; }
form.stack { display: grid; gap: 8px; margin-top: 8px; }
form.inline { display: inline; }
input, button, select { font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--page); color: var(--ink); }
button { background: var(--bar); color: #ffffff; border: none; cursor: pointer; }
button.danger { background: transparent; color: var(--danger); border: 1px solid var(--danger); }
.error { color: var(--danger); }
`;
```

`src/views/layout.tsx`:

```tsx
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { CSS } from "./styles";

export function Layout({ title, children }: { title: string; children: Child }) {
  return (
    <>
      {raw("<!DOCTYPE html>")}
      <html lang="id">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{title}</title>
          <style>{raw(CSS)}</style>
        </head>
        <body>
          <main>{children}</main>
        </body>
      </html>
    </>
  );
}
```

`src/views/login.tsx`:

```tsx
import { Layout } from "./layout";

export function LoginPage({ token, error }: { token: string | null; error?: string }) {
  return (
    <Layout title="Masuk · SpendChat">
      <div class="card">
        <h1>SpendChat</h1>
        {error && <p class="error">{error}</p>}
        {token ? (
          <form method="post" action="/login" class="stack">
            <input type="hidden" name="token" value={token} />
            <button type="submit">Masuk</button>
          </form>
        ) : (
          <p class="secondary">
            Ketik <b>dashboard</b> di WhatsApp untuk dapat link masuk.
          </p>
        )}
      </div>
    </Layout>
  );
}
```

- [ ] **Step 6: Implement the login route and wire it up**

`src/routes/login.tsx`:

```tsx
import { Hono } from "hono";
import { createSession, setSessionCookie } from "../auth";
import { consumeLoginToken } from "../db";
import type { AppEnv } from "../env";
import { LoginPage } from "../views/login";

export const login = new Hono<AppEnv>();

login.get("/", (c) => c.html(<LoginPage token={c.req.query("t") ?? null} />));

login.post("/", async (c) => {
  const form = await c.req.parseBody();
  const token = typeof form.token === "string" ? form.token : "";
  const now = new Date();
  if (!(await consumeLoginToken(c.env.DB, token, now))) {
    return c.html(
      <LoginPage
        token={null}
        error="Link sudah kedaluwarsa atau sudah dipakai. Ketik dashboard di WhatsApp untuk minta link baru."
      />,
      401,
    );
  }
  setSessionCookie(c, await createSession(c.env.SESSION_SECRET, now));
  return c.redirect("/dashboard");
});
```

`src/index.ts`:

```ts
import { Hono } from "hono";
import { requireSession } from "./auth";
import type { AppEnv } from "./env";
import { login } from "./routes/login";
import { webhook } from "./routes/webhook";

const app = new Hono<AppEnv>();

for (const path of ["/dashboard", "/expenses/*", "/categories", "/categories/*"]) {
  app.use(path, requireSession);
}

app.get("/", (c) => c.redirect("/dashboard"));
app.route("/webhook", webhook);
app.route("/login", login);

export default app;
```

- [ ] **Step 7: Run tests**

Run: `pnpm test test/auth.test.ts`
Expected: PASS. Hono's `c.redirect` defaults to 302.

- [ ] **Step 8: Full suite, typecheck, lint, commit** (commit only if authorized)

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add src/auth.ts src/routes/login.tsx src/views src/index.ts test/helpers.ts test/auth.test.ts
git commit -m "feat(auth): add magic-link login and signed session cookie"
```

---

### Task 10: Dashboard page with edit and delete

**Files:**
- Create: `src/routes/form.ts`, `src/routes/dashboard.tsx`, `src/views/dashboard.tsx`
- Modify: `src/index.ts`
- Test: `test/dashboard.test.ts`

**Interfaces:**
- Consumes: `categoryTotals`, `dailyTotals`, `listExpenses`, `listCategories`, `totalForRange`, `updateExpense`, `deleteExpense`, `Expense`, `CategoryTotal` (Task 5); `monthRange`, `monthLabel`, `shiftMonth`, `wibDate`, `wibMonth` (Task 2); `formatRupiah` (Task 2); `Layout` (Task 9); `sessionCookie` (Task 9 helper).
- Produces: routes `GET /dashboard?month=YYYY-MM&category=`, `POST /expenses/:id`, `POST /expenses/:id/delete`; `type DashboardData` in `src/views/dashboard.tsx`.

- [ ] **Step 1: Write failing tests**

`test/dashboard.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { listExpenses, saveExpenses } from "../src/db";
import app from "../src/index";
import type { ParsedExpense } from "../src/parser";
import { sessionCookie } from "./helpers";

const OCT = { from: "2026-10-01", to: "2026-10-31" };
let cookie: string;

function expense(overrides: Partial<ParsedExpense>): ParsedExpense {
  return { ok: true, lineNo: 1, amount: 10_000, description: "x", category: "Lainnya", spentOn: "2026-10-01", tagged: false, ...overrides };
}

async function get(path: string) {
  return app.request(path, { headers: { Cookie: cookie } }, env);
}

async function post(path: string, fields: Record<string, string>) {
  return app.request(
    path,
    {
      method: "POST",
      body: new URLSearchParams(fields),
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    },
    env,
  );
}

beforeEach(async () => {
  cookie = await sessionCookie();
  await saveExpenses(
    env.DB,
    [
      expense({ lineNo: 1, amount: 50_000, description: "bensin", category: "Transport", spentOn: "2026-10-01" }),
      expense({ lineNo: 2, amount: 20_000, description: "makan siang", category: "Makan", spentOn: "2026-10-03" }),
      expense({ lineNo: 3, amount: 40_000, description: "buku", category: "Lainnya", spentOn: "2026-09-10" }),
    ],
    { waMessageId: "seed", now: new Date(), sender: "6281200000000" },
  );
});

describe("GET /dashboard", () => {
  it("shows the month total, comparison, categories and transactions", async () => {
    const response = await get("/dashboard?month=2026-10");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Oktober 2026");
    expect(html).toContain("Rp70.000");
    expect(html).toContain("Rp30.000 lebih banyak dari September 2026");
    expect(html).toContain('href="/dashboard?month=2026-09"');
    expect(html).toContain('href="/dashboard?month=2026-11"');
    expect(html).toContain("bensin");
    expect(html).toContain("makan siang");
    expect(html).not.toContain("buku");
    expect(html).toContain('data-tip="3 Okt: Rp20.000"');
  });

  it("filters transactions by category", async () => {
    const html = await (await get("/dashboard?month=2026-10&category=Makan")).text();
    expect(html).toContain("makan siang");
    expect(html).not.toContain(">bensin<");
  });

  it("uses the average over all days for a past month", async () => {
    const html = await (await get("/dashboard?month=2026-09")).text();
    // Rp40.000 over 30 days
    expect(html).toContain("Rp1.333");
  });

  it("falls back to the current month for an invalid month parameter", async () => {
    expect((await get("/dashboard?month=bogus")).status).toBe(200);
  });
});

describe("expense edits", () => {
  it("updates an expense and redirects to its month", async () => {
    const [row] = await listExpenses(env.DB, OCT, "Transport");
    const response = await post(`/expenses/${row.id}`, {
      amount: "55000",
      description: "bensin full",
      category: "Transport",
      spent_on: "2026-11-02",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/dashboard?month=2026-11");
    expect(await listExpenses(env.DB, { from: "2026-11-01", to: "2026-11-30" }, null)).toEqual([
      { id: row.id, amount: 55_000, description: "bensin full", category: "Transport", spent_on: "2026-11-02" },
    ]);
  });

  it("rejects invalid edits", async () => {
    const [row] = await listExpenses(env.DB, OCT, "Transport");
    const bad = await post(`/expenses/${row.id}`, { amount: "-5", description: "x", category: "Transport", spent_on: "2026-10-01" });
    expect(bad.status).toBe(400);
  });

  it("deletes an expense and returns to the given month", async () => {
    const [row] = await listExpenses(env.DB, OCT, "Makan");
    const response = await post(`/expenses/${row.id}/delete`, { month: "2026-10" });
    expect(response.headers.get("Location")).toBe("/dashboard?month=2026-10");
    expect(await listExpenses(env.DB, OCT, "Makan")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/dashboard.test.ts`
Expected: FAIL — 404 for `/dashboard`.

- [ ] **Step 3: Implement the view**

`src/views/dashboard.tsx`:

```tsx
import type { CategoryTotal, Expense } from "../db";
import { formatRupiah } from "../money";
import { Layout } from "./layout";

export type DashboardData = {
  month: string;
  label: string;
  prevMonth: string;
  prevLabel: string;
  nextMonth: string;
  total: number;
  prevTotal: number;
  averagePerDay: number | null;
  daily: { day: number; total: number }[];
  categories: CategoryTotal[];
  categoryFilter: string | null;
  categoryOptions: string[];
  expenses: Expense[];
};

const SHORT_MONTH = new Intl.DateTimeFormat("id-ID", { month: "short", timeZone: "UTC" });

function shortMonth(month: string): string {
  return SHORT_MONTH.format(new Date(`${month}-01T00:00:00Z`));
}

function Comparison({ total, prevTotal, prevLabel }: { total: number; prevTotal: number; prevLabel: string }) {
  const diff = total - prevTotal;
  if (diff === 0) return <p class="secondary">Sama dengan {prevLabel}</p>;
  return (
    <p class={diff > 0 ? "up" : "down"}>
      {diff > 0 ? "▲" : "▼"} {formatRupiah(Math.abs(diff))} {diff > 0 ? "lebih banyak" : "lebih sedikit"} dari{" "}
      {prevLabel}
    </p>
  );
}

function DailyBars({ month, label, daily }: { month: string; label: string; daily: DashboardData["daily"] }) {
  const max = Math.max(...daily.map((d) => d.total));
  const monthShort = shortMonth(month);
  return (
    <div class="card">
      <h2 class="secondary">Per hari</h2>
      <div class="daily" role="img" aria-label={`Pengeluaran harian ${label}`}>
        {daily.map((d) => (
          <div class="day" tabindex={0} data-tip={`${d.day} ${monthShort}: ${formatRupiah(d.total)}`}>
            <span class="bar" style={`height:${max > 0 ? (d.total / max) * 100 : 0}%`} />
          </div>
        ))}
      </div>
      <div class="axis muted num">
        <span>1</span>
        <span>{daily.length}</span>
      </div>
    </div>
  );
}

function CategoryBars({ month, categories, categoryFilter }: Pick<DashboardData, "month" | "categories" | "categoryFilter">) {
  if (categories.length === 0) return null;
  const max = categories[0].total;
  return (
    <div class="card">
      <h2 class="secondary">Per kategori</h2>
      <ul class="cats">
        {categories.map((cat) => {
          const active = cat.category === categoryFilter;
          const href = active
            ? `/dashboard?month=${month}`
            : `/dashboard?month=${month}&category=${encodeURIComponent(cat.category)}`;
          return (
            <li>
              <a href={href} aria-current={active ? "true" : undefined}>
                <span class="cat-name">{cat.category}</span>
                <span class="num">{formatRupiah(cat.total)}</span>
                <span class="track">
                  <span class="fill" style={`width:${(cat.total / max) * 100}%`} />
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ExpenseRow({ expense, month }: { expense: Expense; month: string }) {
  return (
    <tr>
      <td class="num muted">{Number(expense.spent_on.slice(8))}</td>
      <td>
        {expense.description}
        <div class="muted">{expense.category}</div>
        <details>
          <summary>Ubah</summary>
          <form method="post" action={`/expenses/${expense.id}`} class="stack">
            <input name="amount" type="number" min="1" step="1" required value={String(expense.amount)} />
            <input name="description" required value={expense.description} />
            <input name="category" list="category-options" required value={expense.category} />
            <input name="spent_on" type="date" required value={expense.spent_on} />
            <button type="submit">Simpan</button>
          </form>
          <form
            method="post"
            action={`/expenses/${expense.id}/delete`}
            class="stack"
            onsubmit="return confirm('Hapus pengeluaran ini?')"
          >
            <input type="hidden" name="month" value={month} />
            <button type="submit" class="danger">
              Hapus
            </button>
          </form>
        </details>
      </td>
      <td class="amount num">{formatRupiah(expense.amount)}</td>
    </tr>
  );
}

export function DashboardPage(data: DashboardData) {
  return (
    <Layout title={`${data.label} · SpendChat`}>
      <nav>
        <a href={`/dashboard?month=${data.prevMonth}`}>‹</a>
        <h1>{data.label}</h1>
        <a href={`/dashboard?month=${data.nextMonth}`}>›</a>
      </nav>

      <div class="card">
        <div class="muted">Total</div>
        <div class="hero">{formatRupiah(data.total)}</div>
        <Comparison total={data.total} prevTotal={data.prevTotal} prevLabel={data.prevLabel} />
        <div class="stats">
          <div>
            <div class="muted">Rata-rata per hari</div>
            <div class="num">{data.averagePerDay === null ? "—" : formatRupiah(data.averagePerDay)}</div>
          </div>
          <div>
            <div class="muted">Transaksi</div>
            <div class="num">{data.expenses.length}</div>
          </div>
        </div>
      </div>

      <DailyBars month={data.month} label={data.label} daily={data.daily} />
      <CategoryBars month={data.month} categories={data.categories} categoryFilter={data.categoryFilter} />

      <div class="card">
        <h2 class="secondary">
          Transaksi{data.categoryFilter && ` · ${data.categoryFilter}`}
          {data.categoryFilter && (
            <>
              {" "}
              <a href={`/dashboard?month=${data.month}`}>semua</a>
            </>
          )}
        </h2>
        <datalist id="category-options">
          {data.categoryOptions.map((category) => (
            <option value={category} />
          ))}
        </datalist>
        {data.expenses.length === 0 ? (
          <p class="muted">Belum ada catatan.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tgl</th>
                <th>Keterangan</th>
                <th class="amount">Nominal</th>
              </tr>
            </thead>
            <tbody>
              {data.expenses.map((expense) => (
                <ExpenseRow expense={expense} month={data.month} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p>
        <a href="/categories">Atur kategori</a>
      </p>
    </Layout>
  );
}
```

Rows read category suggestions through the shared `<datalist id="category-options">`.

- [ ] **Step 4: Implement the routes**

`src/routes/form.ts` (shared with Task 11):

```ts
export function field(form: Record<string, string | File>, name: string): string {
  const value = form[name];
  return typeof value === "string" ? value.trim() : "";
}
```

`src/routes/dashboard.tsx`:

```tsx
import { Hono } from "hono";
import {
  categoryTotals,
  dailyTotals,
  deleteExpense,
  listCategories,
  listExpenses,
  totalForRange,
  updateExpense,
} from "../db";
import type { AppEnv } from "../env";
import { monthLabel, monthRange, shiftMonth, wibDate, wibMonth } from "../time";
import { DashboardPage } from "../views/dashboard";
import { field } from "./form";

export const dashboard = new Hono<AppEnv>();

const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

dashboard.get("/dashboard", async (c) => {
  const now = new Date();
  const currentMonth = wibMonth(now);
  const monthParam = c.req.query("month") ?? "";
  const month = MONTH.test(monthParam) ? monthParam : currentMonth;
  const categoryFilter = c.req.query("category") || null;
  const range = monthRange(month);
  const prevMonth = shiftMonth(month, -1);
  const db = c.env.DB;

  const [total, prevTotal, dailyRows, categories, expenses, categoryOptions] = await Promise.all([
    totalForRange(db, range),
    totalForRange(db, monthRange(prevMonth)),
    dailyTotals(db, range),
    categoryTotals(db, range),
    listExpenses(db, range, categoryFilter),
    listCategories(db),
  ]);

  const daysInMonth = Number(range.to.slice(8));
  const byDay = new Map(dailyRows.map((row) => [Number(row.spent_on.slice(8)), row.total]));
  const daily = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, total: byDay.get(i + 1) ?? 0 }));

  const daysCounted =
    month === currentMonth ? Number(wibDate(now).slice(8)) : month < currentMonth ? daysInMonth : 0;

  return c.html(
    <DashboardPage
      month={month}
      label={monthLabel(month)}
      prevMonth={prevMonth}
      prevLabel={monthLabel(prevMonth)}
      nextMonth={shiftMonth(month, 1)}
      total={total}
      prevTotal={prevTotal}
      averagePerDay={daysCounted > 0 ? Math.round(total / daysCounted) : null}
      daily={daily}
      categories={categories}
      categoryFilter={categoryFilter}
      categoryOptions={categoryOptions}
      expenses={expenses}
    />,
  );
});

dashboard.post("/expenses/:id", async (c) => {
  const form = await c.req.parseBody();
  const amount = Number(field(form, "amount"));
  const description = field(form, "description");
  const category = field(form, "category");
  const spentOn = field(form, "spent_on");
  if (!Number.isInteger(amount) || amount <= 0 || !description || !category || !DATE.test(spentOn)) {
    return c.text("Data tidak valid", 400);
  }
  await updateExpense(c.env.DB, Number(c.req.param("id")), { amount, description, category, spentOn });
  return c.redirect(`/dashboard?month=${spentOn.slice(0, 7)}`);
});

dashboard.post("/expenses/:id/delete", async (c) => {
  const form = await c.req.parseBody();
  const month = field(form, "month");
  await deleteExpense(c.env.DB, Number(c.req.param("id")));
  return c.redirect(MONTH.test(month) ? `/dashboard?month=${month}` : "/dashboard");
});
```

In `src/index.ts`, add `import { dashboard } from "./routes/dashboard";` and after the other routes:

```ts
app.route("/", dashboard);
```

- [ ] **Step 5: Run tests**

Run: `pnpm test test/dashboard.test.ts test/auth.test.ts`
Expected: PASS. The `Rp1.333` assertion: `Math.round(40000 / 30)` = 1333.

- [ ] **Step 6: Look at it**

Run: `pnpm dev`, send a signed test request or insert rows with `pnpm wrangler d1 execute spendchat --local --command "INSERT ..."`, create a session by calling the `dashboard` flow, then open `http://localhost:8787/dashboard` at phone width (375px) and desktop, in light and dark. Check: no horizontal scroll, tooltips readable, category bars tap to filter, edit/delete work. Fix layout issues before continuing.

- [ ] **Step 7: Full suite, typecheck, lint, commit** (commit only if authorized)

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add src/routes/form.ts src/routes/dashboard.tsx src/views/dashboard.tsx src/index.ts test/dashboard.test.ts
git commit -m "feat(dashboard): add monthly overview with charts and expense editing"
```

---

### Task 11: Categories page

**Files:**
- Create: `src/routes/categories.tsx`, `src/views/categories.tsx`
- Modify: `src/index.ts`
- Test: `test/categories.test.ts`

**Interfaces:**
- Consumes: `getKeywords`, `upsertKeyword`, `deleteKeyword`, `listCategories` (Task 5); `Layout` (Task 9); `sessionCookie` (Task 9 helper).
- Produces: routes `GET /categories`, `POST /categories`, `POST /categories/delete`.

- [ ] **Step 1: Write failing tests**

`test/categories.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getKeywords } from "../src/db";
import app from "../src/index";
import { sessionCookie } from "./helpers";

let cookie: string;

beforeEach(async () => {
  cookie = await sessionCookie();
});

function post(path: string, fields: Record<string, string>) {
  return app.request(
    path,
    {
      method: "POST",
      body: new URLSearchParams(fields),
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    },
    env,
  );
}

describe("categories page", () => {
  it("lists keywords grouped by category", async () => {
    const html = await (await app.request("/categories", { headers: { Cookie: cookie } }, env)).text();
    expect(html).toContain("Transport");
    expect(html).toContain("bensin");
  });

  it("adds or changes a keyword", async () => {
    const response = await post("/categories", { keyword: " Netflix ", category: "Hiburan" });
    expect(response.headers.get("Location")).toBe("/categories");
    expect(await getKeywords(env.DB)).toContainEqual({ keyword: "netflix", category: "Hiburan" });

    await post("/categories", { keyword: "bensin", category: "Kendaraan" });
    expect(await getKeywords(env.DB)).toContainEqual({ keyword: "bensin", category: "Kendaraan" });
  });

  it("rejects empty fields", async () => {
    expect((await post("/categories", { keyword: "", category: "Hiburan" })).status).toBe(400);
  });

  it("deletes a keyword", async () => {
    await post("/categories/delete", { keyword: "bensin" });
    expect((await getKeywords(env.DB)).some((k) => k.keyword === "bensin")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/categories.test.ts`
Expected: FAIL — 404 for `/categories`.

- [ ] **Step 3: Implement**

`src/views/categories.tsx`:

```tsx
import type { Keyword } from "../parser";
import { Layout } from "./layout";

export function CategoriesPage({ keywords, categoryOptions }: { keywords: Keyword[]; categoryOptions: string[] }) {
  const groups = new Map<string, string[]>();
  for (const { keyword, category } of keywords) {
    groups.set(category, [...(groups.get(category) ?? []), keyword]);
  }

  return (
    <Layout title="Kategori · SpendChat">
      <nav>
        <a href="/dashboard">‹ Dashboard</a>
        <h1>Kategori</h1>
        <span />
      </nav>

      <div class="card">
        <h2 class="secondary">Tambah / ubah kata kunci</h2>
        <form method="post" action="/categories" class="stack">
          <input name="keyword" placeholder="kata kunci, mis. netflix" required />
          <input name="category" list="category-options" placeholder="kategori, mis. Hiburan" required />
          <datalist id="category-options">
            {categoryOptions.map((category) => (
              <option value={category} />
            ))}
          </datalist>
          <button type="submit">Simpan</button>
        </form>
      </div>

      {[...groups].map(([category, words]) => (
        <div class="card">
          <h2>{category}</h2>
          <table>
            <tbody>
              {words.map((keyword) => (
                <tr>
                  <td>{keyword}</td>
                  <td class="amount">
                    <form method="post" action="/categories/delete" class="inline">
                      <input type="hidden" name="keyword" value={keyword} />
                      <button type="submit" class="danger">
                        Hapus
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </Layout>
  );
}
```

`src/routes/categories.tsx`:

```tsx
import { Hono } from "hono";
import { deleteKeyword, getKeywords, listCategories, upsertKeyword } from "../db";
import type { AppEnv } from "../env";
import { CategoriesPage } from "../views/categories";
import { field } from "./form";

export const categories = new Hono<AppEnv>();

categories.get("/", async (c) => {
  const [keywords, categoryOptions] = await Promise.all([getKeywords(c.env.DB), listCategories(c.env.DB)]);
  return c.html(<CategoriesPage keywords={keywords} categoryOptions={categoryOptions} />);
});

categories.post("/", async (c) => {
  const form = await c.req.parseBody();
  const keyword = field(form, "keyword");
  const category = field(form, "category");
  if (!keyword || !category) return c.text("Data tidak valid", 400);
  await upsertKeyword(c.env.DB, keyword, category);
  return c.redirect("/categories");
});

categories.post("/delete", async (c) => {
  const form = await c.req.parseBody();
  await deleteKeyword(c.env.DB, field(form, "keyword"));
  return c.redirect("/categories");
});
```

In `src/index.ts`, add `import { categories } from "./routes/categories";` and:

```ts
app.route("/categories", categories);
```

- [ ] **Step 4: Run tests**

Run: `pnpm test test/categories.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, lint, commit** (commit only if authorized)

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add src/routes src/views/categories.tsx src/index.ts test/categories.test.ts
git commit -m "feat(categories): add keyword to category management page"
```

---

### Task 12: Deployment guide and final verification

**Files:**
- Create: `README.md`
- Modify: `wrangler.jsonc` (only when the user deploys: real `database_id`, `BASE_URL`)

**Interfaces:**
- Consumes: everything above. Produces: setup/deploy instructions.

- [ ] **Step 1: Write README.md**

````markdown
# SpendChat

Personal expense tracker: log expenses by chatting a WhatsApp bot, review them in a web dashboard. Runs on Cloudflare Workers + D1.

## Chat usage

| Send | Result |
|---|---|
| `bensin 50` | Rp50.000 · Transport |
| `makan 20` | Rp20.000 · "makan siang" (time of day added automatically) |
| `kopi 18k #jajan` | Rp18.000 · category Jajan, remembered for "kopi" |
| `kemarin parkir 5rb` / `yesterday parkir 5rb` | dated yesterday |
| several lines | one expense per line |
| `hari ini` / `minggu ini` / `bulan ini` (or `today` / `this week` / `this month`) | summary |
| `hapus` / `undo` | undo the last message |
| `dashboard` | one-time login link |
| `bantuan` / `help` | help |

Bare numbers below 1000 mean thousands: `50` = Rp50.000.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

Copy `.dev.vars.example` to `.dev.vars` and fill it in to run `pnpm dev` locally.

## Deploy

1. `pnpm wrangler login`
2. `pnpm wrangler d1 create spendchat` and put the printed `database_id` into `wrangler.jsonc`.
3. `pnpm wrangler d1 migrations apply spendchat --remote`
4. `pnpm run deploy` once to get the Worker URL (`https://spendchat.<subdomain>.workers.dev`), set it as `BASE_URL` in `wrangler.jsonc`, and deploy again.
5. Set secrets (each command prompts for the value):
   ```bash
   pnpm wrangler secret put WA_ACCESS_TOKEN
   pnpm wrangler secret put WA_APP_SECRET
   pnpm wrangler secret put WA_VERIFY_TOKEN
   pnpm wrangler secret put WA_PHONE_NUMBER_ID
   pnpm wrangler secret put OWNER_WA_NUMBER
   pnpm wrangler secret put SESSION_SECRET
   ```
   - `WA_VERIFY_TOKEN`, `SESSION_SECRET`: any long random strings you choose (e.g. `openssl rand -hex 32`).
   - `OWNER_WA_NUMBER`: your personal number in international format without `+`, e.g. `6281234567890`.

## WhatsApp Cloud API setup

1. At developers.facebook.com create an app of type **Business** and add the **WhatsApp** product.
2. Under WhatsApp → API Setup, add the bot's phone number. It must not be registered in the WhatsApp or WhatsApp Business app; delete that account from the app first. Note the **Phone number ID** → `WA_PHONE_NUMBER_ID`.
3. App Settings → Basic → **App secret** → `WA_APP_SECRET`.
4. In Business Settings create a **System User**, assign the app and the WhatsApp account, and generate a token with `whatsapp_business_messaging` and `whatsapp_business_management` → `WA_ACCESS_TOKEN`. The temporary token on the API Setup page expires in 24 hours; don't use it.
5. WhatsApp → Configuration → Webhook: callback URL `https://<your-worker>/webhook`, verify token = `WA_VERIFY_TOKEN`. Then subscribe to the **messages** field.
6. From your personal number, send `bantuan` to the bot's number.

Logs: `pnpm wrangler tail`.
````

- [ ] **Step 2: Final verification**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all tests pass, no type or lint errors. Paste the output.

- [ ] **Step 3: Commit** (only if authorized)

```bash
git add README.md
git commit -m "docs(readme): add usage, deploy and WhatsApp setup guide"
```

- [ ] **Step 4: Deploy (only when the user asks)**

Deploying creates Cloudflare resources and needs the user's Meta credentials; follow README "Deploy" and "WhatsApp Cloud API setup" together with the user.
