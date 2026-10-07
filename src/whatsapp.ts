import { hmacVerify } from "./crypto";
import type { Bindings } from "./env";

// Bump to the version shown in the Meta App Dashboard when upgrading.
const GRAPH_API_VERSION = "v23.0";

type WaMessage = {
	id: string;
	from: string;
	timestamp: string;
	type: string;
	text?: { body: string };
};

export type WebhookPayload = {
	entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[];
};

export type IncomingMessage = {
	id: string;
	from: string;
	sentAt: Date;
	text: string | null;
};

export async function verifySignature(
	rawBody: string,
	header: string | undefined,
	appSecret: string,
): Promise<boolean> {
	if (!header?.startsWith("sha256=")) return false;
	return hmacVerify(appSecret, rawBody, header.slice("sha256=".length));
}

export function extractMessages(payload: WebhookPayload): IncomingMessage[] {
	return (payload.entry ?? [])
		.flatMap((entry) => entry.changes ?? [])
		.flatMap((change) => change.value?.messages ?? [])
		.map((message) => ({
			id: message.id,
			from: message.from,
			sentAt: new Date(Number(message.timestamp) * 1000),
			text: message.type === "text" && message.text ? message.text.body : null,
		}));
}

export async function sendText(
	env: Bindings,
	to: string,
	body: string,
): Promise<void> {
	const response = await fetch(
		`https://graph.facebook.com/${GRAPH_API_VERSION}/${env.WA_PHONE_NUMBER_ID}/messages`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.WA_ACCESS_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				messaging_product: "whatsapp",
				to,
				type: "text",
				text: { body, preview_url: false },
			}),
		},
	);
	if (!response.ok)
		throw new Error(
			`WhatsApp send failed: ${response.status} ${await response.text()}`,
		);
}
