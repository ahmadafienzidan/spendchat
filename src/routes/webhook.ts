import { Hono } from "hono";
import { handleMessage } from "../bot";
import { isProcessed } from "../db";
import type { AppEnv } from "../env";
import {
	extractMessages,
	sendText,
	verifySignature,
	type WebhookPayload,
} from "../whatsapp";

export const webhook = new Hono<AppEnv>();

webhook.get("/", (c) => {
	const challenge = c.req.query("hub.challenge");
	if (
		c.req.query("hub.mode") === "subscribe" &&
		c.req.query("hub.verify_token") === c.env.WA_VERIFY_TOKEN &&
		challenge
	) {
		return c.text(challenge);
	}
	return c.text("Forbidden", 403);
});

webhook.post("/", async (c) => {
	const rawBody = await c.req.text();
	if (
		!(await verifySignature(
			rawBody,
			c.req.header("X-Hub-Signature-256"),
			c.env.WA_APP_SECRET,
		))
	) {
		return c.text("Invalid signature", 401);
	}

	for (const message of extractMessages(
		JSON.parse(rawBody) as WebhookPayload,
	)) {
		if (message.from !== c.env.OWNER_WA_NUMBER) continue;
		if (isProcessed(c.env.DB, message.id)) continue;
		const reply = handleMessage(c.env, message, new Date());
		await sendText(c.env, message.from, reply);
	}
	return c.text("OK");
});
