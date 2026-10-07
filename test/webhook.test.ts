import { env } from "cloudflare:workers";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from "vitest";
import { listExpenses } from "../src/db";
import app from "../src/index";
import { NON_TEXT_REPLY } from "../src/replies";
import {
	imagePayload,
	mockFetch,
	postWebhook,
	sentBodies,
	statusPayload,
	textPayload,
} from "./helpers";

const OCT = { from: "2026-10-01", to: "2026-10-31" };
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
	fetchSpy = mockFetch();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("GET /webhook", () => {
	it("echoes the challenge for the right verify token", async () => {
		const ok = await app.request(
			"/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345",
			{},
			env,
		);
		expect(ok.status).toBe(200);
		expect(await ok.text()).toBe("12345");

		const bad = await app.request(
			"/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345",
			{},
			env,
		);
		expect(bad.status).toBe(403);
	});
});

describe("POST /webhook", () => {
	it("records the owner's expenses and replies", async () => {
		const response = await postWebhook(
			textPayload({ id: "wamid.1", text: "bensin 50\nmakan 20" }),
		);

		expect(response.status).toBe(200);
		expect(await listExpenses(env.DB, OCT, null)).toHaveLength(2);
		expect(sentBodies(fetchSpy)).toEqual([
			"✅ 2 dicatat\n• Rp50.000 · bensin · Transport\n• Rp20.000 · makan siang · Makan\nHari ini: Rp70.000",
		]);
	});

	it("rejects an invalid signature", async () => {
		const response = await postWebhook(
			textPayload({ id: "wamid.1", text: "bensin 50" }),
			"wrong-secret",
		);
		expect(response.status).toBe(401);
		expect(await listExpenses(env.DB, OCT, null)).toEqual([]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("ignores messages from other numbers", async () => {
		const response = await postWebhook(
			textPayload({ id: "wamid.1", text: "bensin 50", from: "6289999999999" }),
		);
		expect(response.status).toBe(200);
		expect(await listExpenses(env.DB, OCT, null)).toEqual([]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("acknowledges status-only events", async () => {
		expect((await postWebhook(statusPayload())).status).toBe(200);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("does not reprocess a retried delivery", async () => {
		const payload = textPayload({ id: "wamid.1", text: "bensin 50" });
		await postWebhook(payload);
		await postWebhook(payload);

		expect(await listExpenses(env.DB, OCT, null)).toHaveLength(1);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("does not undo twice when 'hapus' is retried", async () => {
		await postWebhook(textPayload({ id: "wamid.1", text: "buku 45" }));
		await postWebhook(
			textPayload({ id: "wamid.2", text: "bensin 50\ncuci 18" }),
		);
		const undo = textPayload({ id: "wamid.3", text: "hapus" });
		await postWebhook(undo);
		await postWebhook(undo);

		expect(
			(await listExpenses(env.DB, OCT, null)).map((e) => e.description),
		).toEqual(["buku"]);
	});

	it("replies to non-text messages", async () => {
		await postWebhook(imagePayload({ id: "wamid.1" }));
		expect(sentBodies(fetchSpy)).toEqual([NON_TEXT_REPLY]);
	});

	it("fails the request when the reply cannot be sent, keeping the saved data", async () => {
		fetchSpy.mockImplementation(
			async () => new Response("down", { status: 500 }),
		);
		const response = await postWebhook(
			textPayload({ id: "wamid.1", text: "bensin 50" }),
		);
		expect(response.status).toBe(500);
		expect(await listExpenses(env.DB, OCT, null)).toHaveLength(1);
	});
});
