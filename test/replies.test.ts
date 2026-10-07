import { describe, expect, it } from "vitest";
import type { ParsedLine } from "../src/parser";
import {
	expensesReply,
	HELP_TEXT,
	loginReply,
	summaryReply,
	undoReply,
} from "../src/replies";

const bensin: ParsedLine = {
	ok: true,
	lineNo: 1,
	amount: 50_000,
	description: "bensin",
	category: "Transport",
	spentOn: "2026-10-01",
	tagged: false,
};
const makan: ParsedLine = {
	...bensin,
	lineNo: 2,
	amount: 20_000,
	description: "makan siang",
	category: "Makan",
};
const skipped: ParsedLine = {
	ok: false,
	lineNo: 3,
	line: "makan siang",
	reason: "no_amount",
};

describe("replies", () => {
	it("confirms a single expense with today's total", () => {
		expect(expensesReply([bensin], 143_000)).toBe(
			"✅ Rp50.000 · bensin · Transport\nHari ini: Rp143.000",
		);
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
		expect(expensesReply([skipped], 0)).toBe(
			`⚠️ Dilewati: "makan siang" (tidak ada nominal)\n\n${HELP_TEXT}`,
		);
		expect(expensesReply([], 0)).toBe(HELP_TEXT);
	});

	it("summarizes totals per category", () => {
		expect(
			summaryReply("Oktober 2026", [
				{ category: "Makan", total: 980_000 },
				{ category: "Transport", total: 620_000 },
			]),
		).toBe(
			"📊 Oktober 2026: Rp1.600.000\n• Makan: Rp980.000\n• Transport: Rp620.000",
		);
		expect(summaryReply("Hari ini", [])).toBe(
			"📊 Hari ini: Rp0\nBelum ada catatan.",
		);
	});

	it("describes undone expenses", () => {
		expect(
			undoReply([
				{
					id: 1,
					amount: 18_000,
					description: "cuci",
					category: "Laundry",
					spent_on: "2026-10-01",
				},
			]),
		).toBe("🗑️ Dihapus:\n• Rp18.000 · cuci · Laundry");
		expect(undoReply([])).toBe("Belum ada catatan.");
	});

	it("sends the login link", () => {
		expect(loginReply("https://spendchat.test/login?t=abc")).toBe(
			"🔐 Link dashboard (berlaku 10 menit, sekali pakai):\nhttps://spendchat.test/login?t=abc",
		);
	});
});
