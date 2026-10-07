import { afterEach, describe, expect, it, vi } from "vitest";
import { hmacSign } from "../src/crypto";
import { extractMessages, sendText, verifySignature } from "../src/whatsapp";
import {
	env,
	imagePayload,
	mockFetch,
	NOON,
	OWNER,
	sentBodies,
	statusPayload,
	textPayload,
} from "./helpers";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("verifySignature", () => {
	it("accepts Meta's sha256= header for the exact body", async () => {
		const body = '{"a":1}';
		const header = `sha256=${await hmacSign("app-secret", body)}`;
		expect(await verifySignature(body, header, "app-secret")).toBe(true);
		expect(await verifySignature(`${body} `, header, "app-secret")).toBe(false);
		expect(
			await verifySignature(
				body,
				header.replace("sha256=", "sha1="),
				"app-secret",
			),
		).toBe(false);
		expect(await verifySignature(body, undefined, "app-secret")).toBe(false);
	});
});

describe("extractMessages", () => {
	it("extracts text messages with their WhatsApp timestamp", () => {
		expect(
			extractMessages(textPayload({ id: "wamid.1", text: "bensin 50" })),
		).toEqual([
			{ id: "wamid.1", from: OWNER, sentAt: NOON, text: "bensin 50" },
		]);
	});

	it("marks non-text messages with null text", () => {
		expect(extractMessages(imagePayload({ id: "wamid.2" }))[0].text).toBeNull();
	});

	it("returns nothing for status-only events", () => {
		expect(extractMessages(statusPayload())).toEqual([]);
		expect(extractMessages({})).toEqual([]);
	});
});

describe("sendText", () => {
	it("posts a text message to the Graph API without link previews", async () => {
		const fetchSpy = mockFetch();
		await sendText(env, OWNER, "halo");

		const [url, init] = fetchSpy.mock.calls[0];
		expect(String(url)).toBe(
			`https://graph.facebook.com/v23.0/${env.WA_PHONE_NUMBER_ID}/messages`,
		);
		expect(init?.method).toBe("POST");
		expect(new Headers(init?.headers).get("Authorization")).toBe(
			`Bearer ${env.WA_ACCESS_TOKEN}`,
		);
		expect(JSON.parse(String(init?.body))).toEqual({
			messaging_product: "whatsapp",
			to: OWNER,
			type: "text",
			text: { body: "halo", preview_url: false },
		});
		expect(sentBodies(fetchSpy)).toEqual(["halo"]);
	});

	it("throws when the Graph API rejects the message", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			async () => new Response("bad token", { status: 401 }),
		);
		await expect(sendText(env, OWNER, "halo")).rejects.toThrow(
			"WhatsApp send failed: 401 bad token",
		);
	});
});
