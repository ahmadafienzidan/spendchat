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
			if (expense.tagged)
				upsertKeyword(db, expense.description, expense.category);
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
		db.prepare("DELETE FROM expenses WHERE wa_message_id = ?").run(
			last.wa_message_id,
		);
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
	const expiresAt = new Date(
		meta.now.getTime() + LOGIN_TOKEN_TTL_MS,
	).toISOString();
	db.transaction(() => {
		db.prepare(
			"INSERT INTO login_tokens (token, expires_at) VALUES (?, ?)",
		).run(token, expiresAt);
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
