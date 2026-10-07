import { describe, expect, it } from "vitest";
import {
	addDays,
	dayRange,
	monthLabel,
	monthRange,
	shiftMonth,
	weekRange,
	wibDate,
	wibHour,
	wibMonth,
} from "../src/time";

describe("time", () => {
	it("converts UTC instants to WIB date, hour and month", () => {
		const lateUtc = new Date("2026-09-30T17:30:00Z"); // 00:30 WIB on Oct 1
		expect(wibDate(lateUtc)).toBe("2026-10-01");
		expect(wibHour(lateUtc)).toBe(0);
		expect(wibMonth(lateUtc)).toBe("2026-10");
	});

	it("adds days across month and year boundaries", () => {
		expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
		expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
	});

	it("builds a single-day range", () => {
		expect(dayRange(new Date("2026-10-01T05:00:00Z"))).toEqual({
			from: "2026-10-01",
			to: "2026-10-01",
		});
	});

	it("builds a Monday–Sunday week", () => {
		// 2026-10-01 is a Thursday
		expect(weekRange(new Date("2026-10-01T05:00:00Z"))).toEqual({
			from: "2026-09-28",
			to: "2026-10-04",
		});
		// Sunday belongs to the week that started on the previous Monday
		expect(weekRange(new Date("2026-10-04T05:00:00Z"))).toEqual({
			from: "2026-09-28",
			to: "2026-10-04",
		});
		// Monday starts a new week
		expect(weekRange(new Date("2026-10-05T05:00:00Z"))).toEqual({
			from: "2026-10-05",
			to: "2026-10-11",
		});
	});

	it("builds month ranges including leap years", () => {
		expect(monthRange("2026-10")).toEqual({
			from: "2026-10-01",
			to: "2026-10-31",
		});
		expect(monthRange("2026-02")).toEqual({
			from: "2026-02-01",
			to: "2026-02-28",
		});
		expect(monthRange("2028-02")).toEqual({
			from: "2028-02-01",
			to: "2028-02-29",
		});
	});

	it("shifts months across years", () => {
		expect(shiftMonth("2026-01", -1)).toBe("2025-12");
		expect(shiftMonth("2026-12", 1)).toBe("2027-01");
	});

	it("labels months in Indonesian", () => {
		expect(monthLabel("2026-10")).toBe("Oktober 2026");
	});
});
