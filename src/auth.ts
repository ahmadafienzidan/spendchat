import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { hmacSign, hmacVerify } from "./crypto";
import type { AppEnv } from "./env";

export const SESSION_COOKIE = "session";
const SESSION_TTL_S = 30 * 24 * 60 * 60;

function sessionPayload(expiresAt: string): string {
	return `session:${expiresAt}`;
}

export async function createSession(
	secret: string,
	now: Date,
): Promise<string> {
	const expiresAt = String(now.getTime() + SESSION_TTL_S * 1000);
	return `${expiresAt}.${await hmacSign(secret, sessionPayload(expiresAt))}`;
}

export async function isValidSession(
	secret: string,
	value: string,
	now: Date,
): Promise<boolean> {
	const [expiresAt, signature] = value.split(".");
	if (!signature || !(Number(expiresAt) > now.getTime())) return false;
	return hmacVerify(secret, sessionPayload(expiresAt), signature);
}

export function setSessionCookie(c: Context<AppEnv>, value: string): void {
	setCookie(c, SESSION_COOKIE, value, {
		httpOnly: true,
		secure: true,
		sameSite: "Lax",
		path: "/",
		maxAge: SESSION_TTL_S,
	});
}

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
	const value = getCookie(c, SESSION_COOKIE);
	if (
		!value ||
		!(await isValidSession(c.env.SESSION_SECRET, value, new Date()))
	)
		return c.redirect("/login");
	await next();
};
