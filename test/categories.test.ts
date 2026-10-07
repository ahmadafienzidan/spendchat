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
			headers: {
				Cookie: cookie,
				"Content-Type": "application/x-www-form-urlencoded",
			},
		},
		env,
	);
}

describe("categories page", () => {
	it("lists keywords grouped by category", async () => {
		const html = await (
			await app.request("/categories", { headers: { Cookie: cookie } }, env)
		).text();
		expect(html).toContain("Transport");
		expect(html).toContain("bensin");
	});

	it("adds or changes a keyword", async () => {
		const response = await post("/categories", {
			keyword: " Netflix ",
			category: "Hiburan",
		});
		expect(response.headers.get("Location")).toBe("/categories");
		expect(await getKeywords(env.DB)).toContainEqual({
			keyword: "netflix",
			category: "Hiburan",
		});

		await post("/categories", { keyword: "bensin", category: "Kendaraan" });
		expect(await getKeywords(env.DB)).toContainEqual({
			keyword: "bensin",
			category: "Kendaraan",
		});
	});

	it("rejects empty fields", async () => {
		expect(
			(await post("/categories", { keyword: "", category: "Hiburan" })).status,
		).toBe(400);
	});

	it("deletes a keyword", async () => {
		await post("/categories/delete", { keyword: "bensin" });
		expect(
			(await getKeywords(env.DB)).some((k) => k.keyword === "bensin"),
		).toBe(false);
	});
});
