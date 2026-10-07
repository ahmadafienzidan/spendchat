import { describe, expect, it } from "vitest";
import { formatRupiah } from "../src/money";

describe("formatRupiah", () => {
	it("uses Indonesian thousands separators", () => {
		expect(formatRupiah(0)).toBe("Rp0");
		expect(formatRupiah(18000)).toBe("Rp18.000");
		expect(formatRupiah(1500000)).toBe("Rp1.500.000");
	});
});
