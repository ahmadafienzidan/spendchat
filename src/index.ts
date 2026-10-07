import { Hono } from "hono";
import type { AppEnv } from "./env";
import { webhook } from "./routes/webhook";

const app = new Hono<AppEnv>();

app.route("/webhook", webhook);

export default app;
