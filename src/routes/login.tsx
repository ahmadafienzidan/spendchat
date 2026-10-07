import { Hono } from "hono";
import { createSession, setSessionCookie } from "../auth";
import { consumeLoginToken } from "../db";
import type { AppEnv } from "../env";
import { LoginPage } from "../views/login";

export const login = new Hono<AppEnv>();

login.get("/", (c) => c.html(<LoginPage token={c.req.query("t") ?? null} />));

login.post("/", async (c) => {
	const form = await c.req.parseBody();
	const token = typeof form.token === "string" ? form.token : "";
	const now = new Date();
	if (!(await consumeLoginToken(c.env.DB, token, now))) {
		return c.html(
			<LoginPage
				token={null}
				error="Link sudah kedaluwarsa atau sudah dipakai. Ketik dashboard di WhatsApp untuk minta link baru."
			/>,
			401,
		);
	}
	setSessionCookie(c, await createSession(c.env.SESSION_SECRET, now));
	return c.redirect("/dashboard");
});
