import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const COMPLETE = {
	PORT: "3000",
	DATABASE_PATH: "/var/lib/spendchat/spendchat.db",
	BASE_URL: "https://spendchat.example.my.id",
	OWNER_WA_NUMBER: "6281200000000",
	WA_ACCESS_TOKEN: "access",
	WA_APP_SECRET: "app-secret",
	WA_VERIFY_TOKEN: "verify",
	WA_PHONE_NUMBER_ID: "1234567890",
	SESSION_SECRET: "session",
};

describe("loadConfig", () => {
	it("builds bindings from a complete environment", () => {
		expect(loadConfig(COMPLETE)).toEqual({
			port: 3000,
			databasePath: "/var/lib/spendchat/spendchat.db",
			bindings: {
				BASE_URL: "https://spendchat.example.my.id",
				OWNER_WA_NUMBER: "6281200000000",
				WA_ACCESS_TOKEN: "access",
				WA_APP_SECRET: "app-secret",
				WA_VERIFY_TOKEN: "verify",
				WA_PHONE_NUMBER_ID: "1234567890",
				SESSION_SECRET: "session",
			},
		});
	});

	it("names every missing or empty variable", () => {
		expect(() =>
			loadConfig({ ...COMPLETE, WA_APP_SECRET: "", SESSION_SECRET: undefined }),
		).toThrow("Missing environment variables: WA_APP_SECRET, SESSION_SECRET");
	});

	it("rejects a port that is not a port number", () => {
		expect(() => loadConfig({ ...COMPLETE, PORT: "abc" })).toThrow(
			"PORT must be a port number",
		);
		expect(() => loadConfig({ ...COMPLETE, PORT: "70000" })).toThrow(
			"PORT must be a port number",
		);
	});
});
