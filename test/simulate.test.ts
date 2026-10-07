import { describe, expect, it } from "vitest";
import { simulate } from "../scripts/simulate";
import { listExpenses } from "../src/db";
import { env, NOON } from "./helpers";

const OCT = { from: "2026-10-01", to: "2026-10-31" };

describe("simulate", () => {
	it("records the arguments as one multi-line owner message and returns the reply", () => {
		expect(simulate(env, ["bensin 50", "makan 20"], NOON)).toBe(
			"✅ 2 dicatat\n• Rp50.000 · bensin · Transport\n• Rp20.000 · makan siang · Makan\nHari ini: Rp70.000",
		);
		expect(listExpenses(env.DB, OCT, null)).toHaveLength(2);
	});

	it("gives every call its own message id", () => {
		simulate(env, ["buku 45"], NOON);
		simulate(env, ["bensin 50"], NOON);
		expect(simulate(env, ["hapus"], NOON)).toBe(
			"🗑️ Dihapus:\n• Rp50.000 · bensin · Transport",
		);
		expect(listExpenses(env.DB, OCT, null).map((e) => e.description)).toEqual([
			"buku",
		]);
	});

	it("answers commands", () => {
		const reply = simulate(env, ["dashboard"], NOON);
		const token = reply.split("?t=")[1];
		expect(reply).toContain("https://spendchat.test/login?t=");
		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});
});
