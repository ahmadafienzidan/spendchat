import type { Bindings } from "./env";

export type Config = {
	port: number;
	databasePath: string;
	bindings: Omit<Bindings, "DB">;
};

const REQUIRED = [
	"PORT",
	"DATABASE_PATH",
	"BASE_URL",
	"OWNER_WA_NUMBER",
	"WA_ACCESS_TOKEN",
	"WA_APP_SECRET",
	"WA_VERIFY_TOKEN",
	"WA_PHONE_NUMBER_ID",
	"SESSION_SECRET",
] as const;

export function loadConfig(source: Record<string, string | undefined>): Config {
	const missing = REQUIRED.filter((name) => !source[name]);
	if (missing.length > 0) {
		throw new Error(`Missing environment variables: ${missing.join(", ")}`);
	}
	// Safe: `missing` is empty, so every required name holds a non-empty string.
	const value = (name: (typeof REQUIRED)[number]) => source[name] as string;

	const port = Number(value("PORT"));
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("PORT must be a port number");
	}

	return {
		port,
		databasePath: value("DATABASE_PATH"),
		bindings: {
			BASE_URL: value("BASE_URL"),
			OWNER_WA_NUMBER: value("OWNER_WA_NUMBER"),
			WA_ACCESS_TOKEN: value("WA_ACCESS_TOKEN"),
			WA_APP_SECRET: value("WA_APP_SECRET"),
			WA_VERIFY_TOKEN: value("WA_VERIFY_TOKEN"),
			WA_PHONE_NUMBER_ID: value("WA_PHONE_NUMBER_ID"),
			SESSION_SECRET: value("SESSION_SECRET"),
		},
	};
}
