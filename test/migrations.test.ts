import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("migrations", () => {
	it("creates tables and seeds keywords", async () => {
		const row = await env.DB.prepare(
			"SELECT category FROM category_keywords WHERE keyword = ?",
		)
			.bind("bensin")
			.first<{ category: string }>();
		expect(row?.category).toBe("Transport");

		const { results } = await env.DB.prepare(
			"SELECT COUNT(*) AS n FROM expenses",
		).all<{ n: number }>();
		expect(results[0].n).toBe(0);
	});
});
