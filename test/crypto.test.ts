import { describe, expect, it } from "vitest";
import { hmacSign, hmacVerify, randomToken } from "../src/crypto";

describe("crypto", () => {
	it("signs and verifies HMAC-SHA256 as hex", async () => {
		const signature = await hmacSign("secret", "payload");
		expect(signature).toMatch(/^[0-9a-f]{64}$/);
		expect(await hmacVerify("secret", "payload", signature)).toBe(true);
		expect(await hmacVerify("secret", "payload!", signature)).toBe(false);
		expect(await hmacVerify("other", "payload", signature)).toBe(false);
		expect(await hmacVerify("secret", "payload", "zz")).toBe(false);
	});

	it("creates distinct 32-byte hex tokens", () => {
		const token = randomToken();
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(randomToken()).not.toBe(token);
	});
});
