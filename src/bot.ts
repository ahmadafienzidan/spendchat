import {
	categoryTotals,
	createLoginToken,
	getKeywords,
	saveExpenses,
	totalForRange,
	undoLastMessage,
} from "./db";
import type { Bindings } from "./env";
import { isExpense, parseMessage } from "./parser";
import {
	expensesReply,
	HELP_TEXT,
	loginReply,
	NON_TEXT_REPLY,
	summaryReply,
	undoReply,
} from "./replies";
import { dayRange, monthLabel, monthRange, weekRange, wibMonth } from "./time";
import type { IncomingMessage } from "./whatsapp";

export async function handleMessage(
	env: Bindings,
	message: IncomingMessage,
	now: Date,
): Promise<string> {
	if (message.text === null) return NON_TEXT_REPLY;

	const db = env.DB;
	const meta = { waMessageId: message.id, now };
	const parsed = parseMessage(
		message.text,
		message.sentAt,
		await getKeywords(db),
	);

	if (parsed.kind === "expenses") {
		const expenses = parsed.lines.filter(isExpense);
		if (expenses.length > 0)
			await saveExpenses(db, expenses, { ...meta, sender: message.from });
		return expensesReply(
			parsed.lines,
			await totalForRange(db, dayRange(message.sentAt)),
		);
	}

	switch (parsed.command) {
		case "today":
			return summaryReply(
				"Hari ini",
				await categoryTotals(db, dayRange(message.sentAt)),
			);
		case "week":
			return summaryReply(
				"Minggu ini",
				await categoryTotals(db, weekRange(message.sentAt)),
			);
		case "month": {
			const month = wibMonth(message.sentAt);
			return summaryReply(
				monthLabel(month),
				await categoryTotals(db, monthRange(month)),
			);
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
