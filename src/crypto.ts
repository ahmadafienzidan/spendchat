const encoder = new TextEncoder();

function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

function toHex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function fromHex(hex: string): Uint8Array {
	return new Uint8Array(
		(hex.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16)),
	);
}

export async function hmacSign(secret: string, data: string): Promise<string> {
	return toHex(
		await crypto.subtle.sign(
			"HMAC",
			await hmacKey(secret),
			encoder.encode(data),
		),
	);
}

export async function hmacVerify(
	secret: string,
	data: string,
	signatureHex: string,
): Promise<boolean> {
	return crypto.subtle.verify(
		"HMAC",
		await hmacKey(secret),
		fromHex(signatureHex),
		encoder.encode(data),
	);
}

export function randomToken(): string {
	return toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
}
