import { env } from "cloudflare:workers";
import { type MockInstance, vi } from "vitest";
import { hmacSign } from "../src/crypto";
import app from "../src/index";
import type { IncomingMessage, WebhookPayload } from "../src/whatsapp";

export const OWNER = "6281200000000";

// 12:00 WIB on Thursday 2026-10-01
export const NOON = new Date("2026-10-01T05:00:00Z");

function unixSeconds(date: Date): string {
	return String(Math.floor(date.getTime() / 1000));
}

function payloadWith(message: Record<string, unknown>): WebhookPayload {
	return {
		entry: [{ changes: [{ value: { messages: [message as never] } }] }],
	};
}

export function textPayload(opts: {
	id: string;
	text: string;
	from?: string;
	sentAt?: Date;
}): WebhookPayload {
	return payloadWith({
		id: opts.id,
		from: opts.from ?? OWNER,
		timestamp: unixSeconds(opts.sentAt ?? NOON),
		type: "text",
		text: { body: opts.text },
	});
}

export function imagePayload(opts: {
	id: string;
	from?: string;
}): WebhookPayload {
	return payloadWith({
		id: opts.id,
		from: opts.from ?? OWNER,
		timestamp: unixSeconds(NOON),
		type: "image",
		image: { id: "media-1" },
	});
}

export function statusPayload(): WebhookPayload {
	return { entry: [{ changes: [{ value: {} }] }] };
}

export function incoming(opts: {
	id: string;
	text: string | null;
	sentAt?: Date;
	from?: string;
}): IncomingMessage {
	return {
		id: opts.id,
		from: opts.from ?? OWNER,
		sentAt: opts.sentAt ?? NOON,
		text: opts.text,
	};
}

export function mockFetch(): MockInstance<typeof fetch> {
	return vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async () => new Response("{}"));
}

export function sentBodies(spy: MockInstance<typeof fetch>): string[] {
	return spy.mock.calls.map(
		([, init]) => JSON.parse(String(init?.body)).text.body,
	);
}

export async function postWebhook(
	payload: unknown,
	secret = env.WA_APP_SECRET,
): Promise<Response> {
	const body = JSON.stringify(payload);
	return app.request(
		"/webhook",
		{
			method: "POST",
			body,
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": `sha256=${await hmacSign(secret, body)}`,
			},
		},
		env,
	);
}
