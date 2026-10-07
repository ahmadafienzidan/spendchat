import { randomToken } from "./crypto";
import type { Keyword, ParsedExpense } from "./parser";
import type { DateRange } from "./time";

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

function markProcessed(db: D1Database, meta: MessageMeta): D1PreparedStatement {
	return db
		.prepare(
			"INSERT INTO processed_messages (wa_message_id, processed_at) VALUES (?, ?)",
		)
		.bind(meta.waMessageId, meta.now.toISOString());
}

function upsertKeywordStatement(
	db: D1Database,
	keyword: string,
	category: string,
): D1PreparedStatement {
	return db
		.prepare(
			"INSERT INTO category_keywords (keyword, category) VALUES (?, ?) ON CONFLICT (keyword) DO UPDATE SET category = excluded.category",
		)
		.bind(keyword.toLowerCase(), category);
}

export async function isProcessed(
	db: D1Database,
	waMessageId: string,
): Promise<boolean> {
	const row = await db
		.prepare("SELECT 1 FROM processed_messages WHERE wa_message_id = ?")
		.bind(waMessageId)
		.first();
	return row !== null;
}

export async function getKeywords(db: D1Database): Promise<Keyword[]> {
	const { results } = await db
		.prepare(
			"SELECT keyword, category FROM category_keywords ORDER BY category, keyword",
		)
		.all<Keyword>();
	return results;
}

export async function upsertKeyword(
	db: D1Database,
	keyword: string,
	category: string,
): Promise<void> {
	await upsertKeywordStatement(db, keyword, category).run();
}

export async function deleteKeyword(
	db: D1Database,
	keyword: string,
): Promise<void> {
	await db
		.prepare("DELETE FROM category_keywords WHERE keyword = ?")
		.bind(keyword)
		.run();
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
		.map((expense) =>
			upsertKeywordStatement(db, expense.description, expense.category),
		);
	await db.batch([...inserts, ...keywords, markProcessed(db, meta)]);
}

export async function undoLastMessage(
	db: D1Database,
	meta: MessageMeta,
): Promise<Expense[]> {
	const last = await db
		.prepare("SELECT wa_message_id FROM expenses ORDER BY id DESC LIMIT 1")
		.first<{ wa_message_id: string }>();
	if (!last) return [];

	const { results } = await db
		.prepare(
			`SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE wa_message_id = ? ORDER BY line_no`,
		)
		.bind(last.wa_message_id)
		.all<Expense>();
	await db.batch([
		db
			.prepare("DELETE FROM expenses WHERE wa_message_id = ?")
			.bind(last.wa_message_id),
		markProcessed(db, meta),
	]);
	return results;
}

export async function totalForRange(
	db: D1Database,
	range: DateRange,
): Promise<number> {
	const row = await db
		.prepare(
			"SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE spent_on BETWEEN ? AND ?",
		)
		.bind(range.from, range.to)
		.first<{ total: number }>();
	return row?.total ?? 0;
}

export async function categoryTotals(
	db: D1Database,
	range: DateRange,
): Promise<CategoryTotal[]> {
	const { results } = await db
		.prepare(
			"SELECT category, SUM(amount) AS total FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY category ORDER BY total DESC, category",
		)
		.bind(range.from, range.to)
		.all<CategoryTotal>();
	return results;
}

export async function dailyTotals(
	db: D1Database,
	range: DateRange,
): Promise<DailyTotal[]> {
	const { results } = await db
		.prepare(
			"SELECT spent_on, SUM(amount) AS total FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY spent_on ORDER BY spent_on",
		)
		.bind(range.from, range.to)
		.all<DailyTotal>();
	return results;
}

export async function listExpenses(
	db: D1Database,
	range: DateRange,
	category: string | null,
): Promise<Expense[]> {
	const statement = category
		? db
				.prepare(
					`SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE spent_on BETWEEN ? AND ? AND category = ? ORDER BY spent_on DESC, id DESC`,
				)
				.bind(range.from, range.to, category)
		: db
				.prepare(
					`SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE spent_on BETWEEN ? AND ? ORDER BY spent_on DESC, id DESC`,
				)
				.bind(range.from, range.to);
	const { results } = await statement.all<Expense>();
	return results;
}

export async function updateExpense(
	db: D1Database,
	id: number,
	update: ExpenseUpdate,
): Promise<void> {
	await db
		.prepare(
			"UPDATE expenses SET amount = ?, description = ?, category = ?, spent_on = ? WHERE id = ?",
		)
		.bind(
			update.amount,
			update.description,
			update.category,
			update.spentOn,
			id,
		)
		.run();
}

export async function deleteExpense(db: D1Database, id: number): Promise<void> {
	await db.prepare("DELETE FROM expenses WHERE id = ?").bind(id).run();
}

export async function createLoginToken(
	db: D1Database,
	meta: MessageMeta,
): Promise<string> {
	const token = randomToken();
	const expiresAt = new Date(
		meta.now.getTime() + LOGIN_TOKEN_TTL_MS,
	).toISOString();
	await db.batch([
		db
			.prepare("INSERT INTO login_tokens (token, expires_at) VALUES (?, ?)")
			.bind(token, expiresAt),
		markProcessed(db, meta),
	]);
	return token;
}

export async function consumeLoginToken(
	db: D1Database,
	token: string,
	now: Date,
): Promise<boolean> {
	const result = await db
		.prepare(
			"UPDATE login_tokens SET used_at = ? WHERE token = ? AND used_at IS NULL AND expires_at > ?",
		)
		.bind(now.toISOString(), token, now.toISOString())
		.run();
	return result.meta.changes === 1;
}
