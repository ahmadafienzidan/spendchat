import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createSession, isValidSession } from "../src/auth";
import { createLoginToken } from "../src/db";
import app from "../src/index";
import { sessionCookie } from "./helpers";

const NOW = new Date("2026-10-01T05:00:00Z");

async function newToken(now = new Date()) {
	return createLoginToken(env.DB, { waMessageId: crypto.randomUUID(), now });
}

function postLogin(token: string) {
	return app.request(
		"/login",
		{
			method: "POST",
			body: new URLSearchParams({ token }),
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
		},
		env,
	);
}

describe("sessions", () => {
	it("accepts a fresh signed session and rejects tampered or expired ones", async () => {
		const value = await createSession("secret", NOW);
		expect(await isValidSession("secret", value, NOW)).toBe(true);
		expect(await isValidSession("other", value, NOW)).toBe(false);
		expect(await isValidSession("secret", `9${value}`, NOW)).toBe(false);
		expect(await isValidSession("secret", "garbage", NOW)).toBe(false);

		const thirtyOneDaysLater = new Date(
			NOW.getTime() + 31 * 24 * 60 * 60 * 1000,
		);
		expect(await isValidSession("secret", value, thirtyOneDaysLater)).toBe(
			false,
		);
	});
});

describe("login flow", () => {
	it("shows a confirm button without consuming the token on GET", async () => {
		const token = await newToken();
		const page = await app.request(`/login?t=${token}`, {}, env);
		expect(page.status).toBe(200);
		const html = await page.text();
		expect(html).toContain(`value="${token}"`);
		expect(html).toContain("Masuk");

		expect((await postLogin(token)).status).toBe(302);
	});

	it("sets a session cookie and redirects on POST with a valid token", async () => {
		const response = await postLogin(await newToken());
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/dashboard");
		const cookie = response.headers.get("Set-Cookie") ?? "";
		expect(cookie).toMatch(/^session=\d+\.[0-9a-f]{64};/);
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("Secure");
		expect(cookie).toContain("SameSite=Lax");
	});

	it("rejects reused, expired and unknown tokens", async () => {
		const token = await newToken();
		await postLogin(token);
		expect((await postLogin(token)).status).toBe(401);

		const expired = await newToken(new Date(Date.now() - 11 * 60 * 1000));
		expect((await postLogin(expired)).status).toBe(401);

		const unknown = await postLogin("nope");
		expect(unknown.status).toBe(401);
		expect(await unknown.text()).toContain(
			"Link sudah kedaluwarsa atau sudah dipakai",
		);
	});

	it("explains how to log in when no token is given", async () => {
		expect(await (await app.request("/login", {}, env)).text()).toContain(
			"Ketik <b>dashboard</b> di WhatsApp",
		);
	});
});

describe("requireSession", () => {
	it("redirects protected pages to /login without a valid session", async () => {
		for (const path of ["/dashboard", "/categories"]) {
			const response = await app.request(path, {}, env);
			expect(response.status).toBe(302);
			expect(response.headers.get("Location")).toBe("/login");
		}
		const forged = await app.request(
			"/dashboard",
			{ headers: { Cookie: "session=123.abc" } },
			env,
		);
		expect(forged.status).toBe(302);
	});

	it("lets a valid session through", async () => {
		const response = await app.request(
			"/dashboard",
			{ headers: { Cookie: await sessionCookie() } },
			env,
		);
		expect(response.status).not.toBe(302);
	});

	it("redirects the root to the dashboard", async () => {
		const response = await app.request("/", {}, env);
		expect(response.headers.get("Location")).toBe("/dashboard");
	});
});
