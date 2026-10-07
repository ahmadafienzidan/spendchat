import { Hono } from "hono";
import { requireSession } from "./auth";
import type { AppEnv } from "./env";
import { login } from "./routes/login";
import { webhook } from "./routes/webhook";

const app = new Hono<AppEnv>();

for (const path of [
	"/dashboard",
	"/expenses/*",
	"/categories",
	"/categories/*",
]) {
	app.use(path, requireSession);
}

app.get("/", (c) => c.redirect("/dashboard"));
app.route("/webhook", webhook);
app.route("/login", login);

export default app;
