import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { CSS } from "./styles";

export function Layout({
	title,
	children,
}: {
	title: string;
	children: Child;
}) {
	return (
		<>
			{raw("<!DOCTYPE html>")}
			<html lang="id">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<title>{title}</title>
					<style>{raw(CSS)}</style>
				</head>
				<body>
					<main>{children}</main>
				</body>
			</html>
		</>
	);
}
