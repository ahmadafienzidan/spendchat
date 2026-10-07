import type Database from "better-sqlite3";

export type Bindings = {
	DB: Database.Database;
	BASE_URL: string;
	WA_ACCESS_TOKEN: string;
	WA_APP_SECRET: string;
	WA_VERIFY_TOKEN: string;
	WA_PHONE_NUMBER_ID: string;
	OWNER_WA_NUMBER: string;
	SESSION_SECRET: string;
};

export type AppEnv = { Bindings: Bindings };
