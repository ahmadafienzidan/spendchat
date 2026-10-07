import { Hono } from "hono";
import {
	deleteKeyword,
	getKeywords,
	listCategories,
	upsertKeyword,
} from "../db";
import type { AppEnv } from "../env";
import { CategoriesPage } from "../views/categories";
import { field } from "./form";

export const categories = new Hono<AppEnv>();

categories.get("/", (c) => {
	const keywords = getKeywords(c.env.DB);
	const categoryOptions = listCategories(c.env.DB);
	return c.html(
		<CategoriesPage keywords={keywords} categoryOptions={categoryOptions} />,
	);
});

categories.post("/", async (c) => {
	const form = await c.req.parseBody();
	const keyword = field(form, "keyword");
	const category = field(form, "category");
	if (!keyword || !category) return c.text("Data tidak valid", 400);
	upsertKeyword(c.env.DB, keyword, category);
	return c.redirect("/categories");
});

categories.post("/delete", async (c) => {
	const form = await c.req.parseBody();
	deleteKeyword(c.env.DB, field(form, "keyword"));
	return c.redirect("/categories");
});
