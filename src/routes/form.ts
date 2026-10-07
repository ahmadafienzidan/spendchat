export function field(
	form: Record<string, string | File>,
	name: string,
): string {
	const value = form[name];
	return typeof value === "string" ? value.trim() : "";
}
