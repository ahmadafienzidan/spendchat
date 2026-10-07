import { describe, expect, it } from "vitest";
import { parseAmount } from "../src/parser";

describe("parseAmount", () => {
	it.each([
		["25000", 25_000],
		["25.000", 25_000],
		["25,000", 25_000],
		["1.500.000", 1_500_000],
		["25rb", 25_000],
		["25ribu", 25_000],
		["18k", 18_000],
		["18K", 18_000],
		["2.5k", 2_500],
		["1,5rb", 1_500],
		["1.5jt", 1_500_000],
		["1,5jt", 1_500_000],
		["2juta", 2_000_000],
	])("parses %s", (token, expected) => {
		expect(parseAmount(token)).toBe(expected);
	});

	it("treats bare numbers below 1000 as thousands", () => {
		expect(parseAmount("50")).toBe(50_000);
		expect(parseAmount("7")).toBe(7_000);
		expect(parseAmount("999")).toBe(999_000);
		expect(parseAmount("1000")).toBe(1_000);
	});

	it.each(["makan", "pagi", "#jajan", "0", "0rb", "1.500.000jt", "12abc", ""])(
		"rejects %j",
		(token) => {
			expect(parseAmount(token)).toBeNull();
		},
	);
});
