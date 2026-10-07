import { randomUUID } from "node:crypto";
import { handleMessage } from "../src/bot";
import type { Bindings } from "../src/env";

export function simulate(env: Bindings, lines: string[], now: Date): string {
	return handleMessage(
		env,
		{
			id: `local.${randomUUID()}`,
			from: env.OWNER_WA_NUMBER,
			sentAt: now,
			text: lines.join("\n"),
		},
		now,
	);
}
