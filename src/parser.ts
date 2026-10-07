const AMOUNT = /^(\d+(?:[.,]\d+)*)(rb|ribu|k|jt|juta)?$/i;

const MULTIPLIERS: Record<string, number> = {
	rb: 1_000,
	ribu: 1_000,
	k: 1_000,
	jt: 1_000_000,
	juta: 1_000_000,
};

export function parseAmount(token: string): number | null {
	const match = AMOUNT.exec(token);
	if (!match) return null;
	const [, digits, suffix] = match;

	let amount: number;
	if (suffix) {
		// With a suffix the separator is decimal: 1,5jt = 1.5 million.
		amount =
			Number(digits.replace(",", ".")) * MULTIPLIERS[suffix.toLowerCase()];
	} else {
		amount = Number(digits.replace(/[.,]/g, ""));
		if (amount < 1000) amount *= 1000;
	}

	amount = Math.round(amount);
	return amount > 0 ? amount : null;
}
