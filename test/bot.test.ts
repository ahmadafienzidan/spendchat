import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { handleMessage } from "../src/bot";
import { getKeywords, isProcessed, listExpenses } from "../src/db";
import { HELP_TEXT, NON_TEXT_REPLY } from "../src/replies";
import { incoming, NOON } from "./helpers";

const OCT = { from: "2026-10-01", to: "2026-10-31" };

function send(id: string, text: string | null, sentAt = NOON) {
	return handleMessage(env, incoming({ id, text, sentAt }), NOON);
}

describe("handleMessage", () => {
	it("records a multi-line message and replies with today's total", async () => {
		const reply = await send("m1", "bensin 50\nmakan 20\nmakan siang");

		expect(reply).toBe(
			[
				"✅ 2 dicatat",
				"• Rp50.000 · bensin · Transport",
				"• Rp20.000 · makan siang · Makan",
				'⚠️ Dilewati: "makan siang" (tidak ada nominal)',
				"Hari ini: Rp70.000",
			].join("\n"),
		);
		expect(
			(await listExpenses(env.DB, OCT, null)).map((e) => e.description),
		).toEqual(["makan siang", "bensin"]);
		expect(await isProcessed(env.DB, "m1")).toBe(true);
	});

	it("does not mark a message processed when nothing was saved", async () => {
		expect(await send("m1", "halo")).toContain(HELP_TEXT);
		expect(await isProcessed(env.DB, "m1")).toBe(false);
	});

	it("remembers a #tag for the description", async () => {
		await send("m1", "kopi 18k #jajan");
		expect(await getKeywords(env.DB)).toContainEqual({
			keyword: "kopi",
			category: "Jajan",
		});
		expect(await send("m2", "kopi 20")).toBe(
			"✅ Rp20.000 · kopi · Jajan\nHari ini: Rp38.000",
		);
	});

	it("excludes yesterday's entries from today's total", async () => {
		expect(await send("m1", "kemarin parkir 5")).toBe(
			"✅ Rp5.000 · parkir · Transport\nHari ini: Rp0",
		);
	});

	it("summarizes today, this week and this month", async () => {
		await send("m1", "bensin 50\nmakan 20");
		await send("m2", "kemarin cuci 18");
		await send("m3", "buku 100", new Date("2026-09-15T05:00:00Z"));

		expect(await send("c1", "hari ini")).toBe(
			"📊 Hari ini: Rp70.000\n• Transport: Rp50.000\n• Makan: Rp20.000",
		);
		expect(await send("c2", "minggu ini")).toBe(
			"📊 Minggu ini: Rp88.000\n• Transport: Rp50.000\n• Makan: Rp20.000\n• Laundry: Rp18.000",
		);
		expect(await send("c3", "bulan ini")).toBe(
			"📊 Oktober 2026: Rp70.000\n• Transport: Rp50.000\n• Makan: Rp20.000",
		);
	});

	it("undoes the whole last message", async () => {
		await send("m1", "buku 45");
		await send("m2", "bensin 50\ncuci 18");

		expect(await send("u1", "hapus")).toBe(
			"🗑️ Dihapus:\n• Rp50.000 · bensin · Transport\n• Rp18.000 · cuci · Laundry",
		);
		expect(
			(await listExpenses(env.DB, OCT, null)).map((e) => e.description),
		).toEqual(["buku"]);
	});

	it("creates a login link", async () => {
		const reply = await send("d1", "dashboard");
		expect(reply).toMatch(
			/^🔐 Link dashboard \(berlaku 10 menit, sekali pakai\):\nhttps:\/\/spendchat\.test\/login\?t=[0-9a-f]{64}$/,
		);
		expect(await isProcessed(env.DB, "d1")).toBe(true);
	});

	it("answers help and non-text messages", async () => {
		expect(await send("h1", "bantuan")).toBe(HELP_TEXT);
		expect(await send("i1", null)).toBe(NON_TEXT_REPLY);
	});
});
