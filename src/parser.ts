import { addDays, wibDate, wibHour } from "./time";

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
		amount =
			Number(digits.replace(",", ".")) * MULTIPLIERS[suffix.toLowerCase()];
	} else {
		amount = Number(digits.replace(/[.,]/g, ""));
		if (amount < 1000) amount *= 1000;
	}

	amount = Math.round(amount);
	return amount > 0 ? amount : null;
}

export type Command =
	| "today"
	| "week"
	| "month"
	| "undo"
	| "dashboard"
	| "help";

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

export type ParsedMessage =
	| { kind: "command"; command: Command }
	| { kind: "expenses"; lines: ParsedLine[] };

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

export function parseMessage(
	text: string,
	sentAt: Date,
	keywords: Keyword[],
): ParsedMessage {
	const command = COMMANDS.get(text.trim().toLowerCase().replace(/\s+/g, " "));
	if (command) return { kind: "command", command };

	const rawLines = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	return {
		kind: "expenses",
		lines: rawLines.map((line, i) => parseLine(line, i + 1, sentAt, keywords)),
	};
}

function parseLine(
	line: string,
	lineNo: number,
	sentAt: Date,
	keywords: Keyword[],
): ParsedLine {
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
	if (description === "")
		return { ok: false, lineNo, line, reason: "no_description" };
	if (!yesterday && description.toLowerCase() === "makan")
		description = mealLabel(wibHour(sentAt));

	const category = tag
		? capitalize(tag)
		: (matchCategory(description, keywords) ?? "Lainnya");
	return {
		ok: true,
		lineNo,
		amount,
		description,
		category,
		spentOn,
		tagged: tag !== null,
	};
}

function mealLabel(hour: number): string {
	if (hour >= 4 && hour < 11) return "makan pagi";
	if (hour >= 11 && hour < 15) return "makan siang";
	if (hour >= 15 && hour < 18) return "makan sore";
	return "makan malam";
}

function matchCategory(
	description: string,
	keywords: Keyword[],
): string | null {
	const padded = ` ${description.toLowerCase().split(/\s+/).join(" ")} `;
	let best: Keyword | null = null;
	for (const entry of keywords) {
		if (
			padded.includes(` ${entry.keyword} `) &&
			(!best || entry.keyword.length > best.keyword.length)
		) {
			best = entry;
		}
	}
	return best?.category ?? null;
}

function capitalize(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
