import { beforeEach, describe, expect, it } from "vitest";
import { listExpenses, saveExpenses } from "../src/db";
import app from "../src/index";
import type { ParsedExpense } from "../src/parser";
import { env, sessionCookie } from "./helpers";

const OCT = { from: "2026-10-01", to: "2026-10-31" };
let cookie: string;

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

async function get(path: string) {
	return app.request(path, { headers: { Cookie: cookie } }, env);
}

async function post(path: string, fields: Record<string, string>) {
	return app.request(
		path,
		{
			method: "POST",
			body: new URLSearchParams(fields),
			headers: {
				Cookie: cookie,
				"Content-Type": "application/x-www-form-urlencoded",
			},
		},
		env,
	);
}

beforeEach(async () => {
	cookie = await sessionCookie();
	await saveExpenses(
		env.DB,
		[
			expense({
				lineNo: 1,
				amount: 50_000,
				description: "bensin",
				category: "Transport",
				spentOn: "2026-10-01",
			}),
			expense({
				lineNo: 2,
				amount: 20_000,
				description: "makan siang",
				category: "Makan",
				spentOn: "2026-10-03",
			}),
			expense({
				lineNo: 3,
				amount: 40_000,
				description: "buku",
				category: "Lainnya",
				spentOn: "2026-09-10",
			}),
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
		const html = await (
			await get("/dashboard?month=2026-10&category=Makan")
		).text();
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
		expect(
			await listExpenses(
				env.DB,
				{ from: "2026-11-01", to: "2026-11-30" },
				null,
			),
		).toEqual([
			{
				id: row.id,
				amount: 55_000,
				description: "bensin full",
				category: "Transport",
				spent_on: "2026-11-02",
			},
		]);
	});

	it("rejects invalid edits", async () => {
		const [row] = await listExpenses(env.DB, OCT, "Transport");
		const bad = await post(`/expenses/${row.id}`, {
			amount: "-5",
			description: "x",
			category: "Transport",
			spent_on: "2026-10-01",
		});
		expect(bad.status).toBe(400);
	});

	it("deletes an expense and returns to the given month", async () => {
		const [row] = await listExpenses(env.DB, OCT, "Makan");
		const response = await post(`/expenses/${row.id}/delete`, {
			month: "2026-10",
		});
		expect(response.headers.get("Location")).toBe("/dashboard?month=2026-10");
		expect(await listExpenses(env.DB, OCT, "Makan")).toEqual([]);
	});
});
