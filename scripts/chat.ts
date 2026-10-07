import { loadConfig } from "../src/config";
import { openDatabase } from "../src/database";
import { simulate } from "./simulate";

const lines = process.argv.slice(2);
if (lines.length === 0) {
	console.error('Usage: pnpm chat "bensin 50" ["makan 20" ...]');
	process.exit(1);
}

const config = loadConfig(process.env);
const { db } = openDatabase(config.databasePath);
console.log(simulate({ ...config.bindings, DB: db }, lines, new Date()));
