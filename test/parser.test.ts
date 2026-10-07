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
	if (parsed.kind !== "expenses")
		throw new Error(`expected expenses, got ${parsed.command}`);
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
		expect(parseMessage(text, NOON, KEYWORDS)).toEqual({
			kind: "command",
			command,
		});
	});

	it("only matches whole-message commands", () => {
		expect(parseMessage("hari ini makan 20", NOON, KEYWORDS).kind).toBe(
			"expenses",
		);
		expect(parseMessage("today makan 20", NOON, KEYWORDS).kind).toBe(
			"expenses",
		);
	});

	it("does not treat object prototype keys as commands", () => {
		expect(parseMessage("constructor", NOON, KEYWORDS).kind).toBe("expenses");
	});
});

describe("parseMessage expenses", () => {
	it("parses the multi-line example at noon", () => {
		expect(
			lines("bensin 50\nmakan 20\nsarapan 10\nmakan pagi 7\ncuci 18"),
		).toEqual([
			{
				ok: true,
				lineNo: 1,
				amount: 50_000,
				description: "bensin",
				category: "Transport",
				spentOn: "2026-10-01",
				tagged: false,
			},
			{
				ok: true,
				lineNo: 2,
				amount: 20_000,
				description: "makan siang",
				category: "Makan",
				spentOn: "2026-10-01",
				tagged: false,
			},
			{
				ok: true,
				lineNo: 3,
				amount: 10_000,
				description: "sarapan",
				category: "Makan",
				spentOn: "2026-10-01",
				tagged: false,
			},
			{
				ok: true,
				lineNo: 4,
				amount: 7_000,
				description: "makan pagi",
				category: "Makan",
				spentOn: "2026-10-01",
				tagged: false,
			},
			{
				ok: true,
				lineNo: 5,
				amount: 18_000,
				description: "cuci",
				category: "Laundry",
				spentOn: "2026-10-01",
				tagged: false,
			},
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
		expect(lines("Kemarin parkir 5rb")[0]).toMatchObject({
			amount: 5_000,
			description: "parkir",
			spentOn: "2026-09-30",
		});
	});

	it("accepts 'yesterday' like 'kemarin'", () => {
		expect(lines("yesterday parkir 5rb")[0]).toMatchObject({
			amount: 5_000,
			description: "parkir",
			spentOn: "2026-09-30",
		});
		expect(lines("Yesterday makan 20")[0]).toMatchObject({
			description: "makan",
			spentOn: "2026-09-30",
		});
	});

	it("uses the WIB date of the message, not UTC", () => {
		// 00:30 WIB on Oct 1 is still Sep 30 in UTC
		expect(
			lines("bensin 50", new Date("2026-09-30T17:30:00Z"))[0],
		).toMatchObject({ spentOn: "2026-10-01" });
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
		expect(lines("sewa kos 1.5jt")[0]).toMatchObject({
			amount: 1_500_000,
			description: "sewa kos",
			category: "Kos",
		});
	});

	it("matches keywords as whole words only", () => {
		expect(lines("pencucian 20")[0]).toMatchObject({ category: "Lainnya" });
	});

	it("falls back to Lainnya", () => {
		expect(lines("buku 45")[0]).toMatchObject({
			description: "buku",
			category: "Lainnya",
		});
	});

	it("takes the first amount token and keeps later numbers in the description", () => {
		expect(lines("beli 2 tiket 3")[0]).toMatchObject({
			amount: 2_000,
			description: "beli tiket 3",
		});
	});

	it("skips lines without an amount or a description", () => {
		expect(lines("makan siang\n50\nbensin 50")).toEqual([
			{ ok: false, lineNo: 1, line: "makan siang", reason: "no_amount" },
			{ ok: false, lineNo: 2, line: "50", reason: "no_description" },
			{
				ok: true,
				lineNo: 3,
				amount: 50_000,
				description: "bensin",
				category: "Transport",
				spentOn: "2026-10-01",
				tagged: false,
			},
		]);
	});
});
