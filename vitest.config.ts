import {
	cloudflareTest,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
	const migrations = await readD1Migrations("./migrations");
	return {
		plugins: [
			cloudflareTest({
				wrangler: { configPath: "./wrangler.jsonc" },
				miniflare: {
					bindings: {
						TEST_MIGRATIONS: migrations,
						BASE_URL: "https://spendchat.test",
						WA_ACCESS_TOKEN: "test-access-token",
						WA_APP_SECRET: "test-app-secret",
						WA_VERIFY_TOKEN: "test-verify-token",
						WA_PHONE_NUMBER_ID: "1234567890",
						OWNER_WA_NUMBER: "6281200000000",
						SESSION_SECRET: "test-session-secret",
					},
				},
			}),
		],
		test: { setupFiles: ["./test/setup.ts"] },
	};
});
