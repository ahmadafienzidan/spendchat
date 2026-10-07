export type DateRange = { from: string; to: string };

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Shifting by the offset lets the UTC getters read WIB wall-clock values.
function toWib(date: Date): Date {
	return new Date(date.getTime() + WIB_OFFSET_MS);
}

export function wibDate(date: Date): string {
	return toWib(date).toISOString().slice(0, 10);
}

export function wibHour(date: Date): number {
	return toWib(date).getUTCHours();
}

export function wibMonth(date: Date): string {
	return wibDate(date).slice(0, 7);
}

export function addDays(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

export function dayRange(date: Date): DateRange {
	const day = wibDate(date);
	return { from: day, to: day };
}

export function weekRange(date: Date): DateRange {
	const day = wibDate(date);
	const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
	const from = addDays(day, -((weekday + 6) % 7));
	return { from, to: addDays(from, 6) };
}

export function monthRange(month: string): DateRange {
	const [year, monthNumber] = month.split("-").map(Number);
	const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
	return {
		from: `${month}-01`,
		to: `${month}-${String(lastDay).padStart(2, "0")}`,
	};
}

export function shiftMonth(month: string, delta: number): string {
	const [year, monthNumber] = month.split("-").map(Number);
	return new Date(Date.UTC(year, monthNumber - 1 + delta, 1))
		.toISOString()
		.slice(0, 7);
}

const monthFormat = new Intl.DateTimeFormat("id-ID", {
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});

export function monthLabel(month: string): string {
	return monthFormat.format(new Date(`${month}-01T00:00:00Z`));
}
