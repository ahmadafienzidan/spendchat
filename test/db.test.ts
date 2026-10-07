import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
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
import { env } from "./helpers";

let db: Database.Database;

beforeEach(() => {
	db = env.DB;
});

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
	await saveExpenses(db, expenses, {
		waMessageId,
		now: NOW,
		sender: "6281200000000",
	});
}

describe("db", () => {
	it("saves expenses and marks the message processed in one batch", async () => {
		await save("m1", [
			expense({
				lineNo: 1,
				amount: 50_000,
				description: "bensin",
				category: "Transport",
			}),
			expense({
				lineNo: 2,
				amount: 20_000,
				description: "makan siang",
				category: "Makan",
			}),
		]);
		expect(await isProcessed(db, "m1")).toBe(true);
		expect(await isProcessed(db, "m2")).toBe(false);
		expect(await totalForRange(db, OCT)).toBe(70_000);
	});

	it("upserts keywords for tagged expenses", async () => {
		await save("m1", [
			expense({ description: "Kopi Susu", category: "Jajan", tagged: true }),
		]);
		const keywords = await getKeywords(db);
		expect(keywords).toContainEqual({
			keyword: "kopi susu",
			category: "Jajan",
		});
	});

	it("undoes every expense of the most recent message", async () => {
		await save("m1", [expense({ description: "a" })]);
		await save("m2", [
			expense({ lineNo: 1, description: "b" }),
			expense({ lineNo: 2, description: "c" }),
		]);

		const deleted = await undoLastMessage(db, {
			waMessageId: "undo1",
			now: NOW,
		});

		expect(deleted.map((e) => e.description)).toEqual(["b", "c"]);
		expect(
			(await listExpenses(db, OCT, null)).map((e) => e.description),
		).toEqual(["a"]);
		expect(await isProcessed(db, "undo1")).toBe(true);
	});

	it("returns nothing to undo on an empty table", async () => {
		expect(
			await undoLastMessage(db, { waMessageId: "undo1", now: NOW }),
		).toEqual([]);
	});

	it("sums per category and per day within the range", async () => {
		await save("m1", [
			expense({
				lineNo: 1,
				amount: 50_000,
				category: "Transport",
				spentOn: "2026-10-01",
			}),
			expense({
				lineNo: 2,
				amount: 20_000,
				category: "Makan",
				spentOn: "2026-10-01",
			}),
			expense({
				lineNo: 3,
				amount: 30_000,
				category: "Makan",
				spentOn: "2026-10-03",
			}),
			expense({
				lineNo: 4,
				amount: 99_000,
				category: "Makan",
				spentOn: "2026-09-30",
			}),
		]);
		expect(await categoryTotals(db, OCT)).toEqual([
			{ category: "Makan", total: 50_000 },
			{ category: "Transport", total: 50_000 },
		]);
		expect(await dailyTotals(db, OCT)).toEqual([
			{ spent_on: "2026-10-01", total: 70_000 },
			{ spent_on: "2026-10-03", total: 30_000 },
		]);
		expect(
			await totalForRange(db, { from: "2026-11-01", to: "2026-11-30" }),
		).toBe(0);
	});

	it("lists expenses newest first, optionally by category", async () => {
		await save("m1", [
			expense({
				lineNo: 1,
				description: "old",
				category: "Makan",
				spentOn: "2026-10-01",
			}),
			expense({
				lineNo: 2,
				description: "new",
				category: "Makan",
				spentOn: "2026-10-05",
			}),
			expense({
				lineNo: 3,
				description: "fuel",
				category: "Transport",
				spentOn: "2026-10-03",
			}),
		]);
		expect(
			(await listExpenses(db, OCT, null)).map((e) => e.description),
		).toEqual(["new", "fuel", "old"]);
		expect(
			(await listExpenses(db, OCT, "Makan")).map((e) => e.description),
		).toEqual(["new", "old"]);
	});

	it("updates and deletes an expense", async () => {
		await save("m1", [expense({ description: "salah" })]);
		const [row] = await listExpenses(db, OCT, null);

		await updateExpense(db, row.id, {
			amount: 12_000,
			description: "benar",
			category: "Makan",
			spentOn: "2026-10-02",
		});
		expect(await listExpenses(db, OCT, null)).toEqual([
			{
				id: row.id,
				amount: 12_000,
				description: "benar",
				category: "Makan",
				spent_on: "2026-10-02",
			},
		]);

		await deleteExpense(db, row.id);
		expect(await listExpenses(db, OCT, null)).toEqual([]);
	});

	it("manages keywords and lists known categories", async () => {
		await upsertKeyword(db, "Netflix", "Hiburan");
		expect(await getKeywords(db)).toContainEqual({
			keyword: "netflix",
			category: "Hiburan",
		});
		await upsertKeyword(db, "netflix", "Langganan");
		expect(await getKeywords(db)).toContainEqual({
			keyword: "netflix",
			category: "Langganan",
		});

		await save("m1", [expense({ category: "Hadiah" })]);
		const categories = await listCategories(db);
		expect(categories).toEqual(
			expect.arrayContaining([
				"Hadiah",
				"Langganan",
				"Lainnya",
				"Makan",
				"Transport",
			]),
		);
		expect(new Set(categories).size).toBe(categories.length);

		await deleteKeyword(db, "netflix");
		expect((await getKeywords(db)).some((k) => k.keyword === "netflix")).toBe(
			false,
		);
	});

	it("consumes a login token once and only before it expires", async () => {
		const token = await createLoginToken(db, {
			waMessageId: "dash1",
			now: NOW,
		});
		expect(await isProcessed(db, "dash1")).toBe(true);

		expect(await consumeLoginToken(db, "nope", NOW)).toBe(false);
		expect(await consumeLoginToken(db, token, NOW)).toBe(true);
		expect(await consumeLoginToken(db, token, NOW)).toBe(false);

		const expiring = await createLoginToken(db, {
			waMessageId: "dash2",
			now: NOW,
		});
		const elevenMinutesLater = new Date(NOW.getTime() + 11 * 60 * 1000);
		expect(await consumeLoginToken(db, expiring, elevenMinutesLater)).toBe(
			false,
		);
	});
});
