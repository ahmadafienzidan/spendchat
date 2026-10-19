import { Hono } from "hono";
import {
	categoryTotals,
	dailyTotals,
	deleteExpense,
	listCategories,
	listExpenses,
	totalForRange,
	updateExpense,
} from "../db";
import type { AppEnv } from "../env";
import { monthLabel, monthRange, shiftMonth, wibDate, wibMonth } from "../time";
import { DashboardPage } from "../views/dashboard";
import { field } from "./form";

export const dashboard = new Hono<AppEnv>();

const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Without it Excel reads the file as ANSI and garbles non-ASCII text.
const UTF8_BOM = String.fromCharCode(0xfeff);

dashboard.get("/dashboard", (c) => {
	const now = new Date();
	const currentMonth = wibMonth(now);
	const monthParam = c.req.query("month") ?? "";
	const month = MONTH.test(monthParam) ? monthParam : currentMonth;
	const categoryFilter = c.req.query("category") || null;
	const range = monthRange(month);
	const prevMonth = shiftMonth(month, -1);
	const db = c.env.DB;

	const total = totalForRange(db, range);
	const prevTotal = totalForRange(db, monthRange(prevMonth));
	const dailyRows = dailyTotals(db, range);
	const categories = categoryTotals(db, range);
	const expenses = listExpenses(db, range, categoryFilter);
	const categoryOptions = listCategories(db);

	const daysInMonth = Number(range.to.slice(8));
	const byDay = new Map(
		dailyRows.map((row) => [Number(row.spent_on.slice(8)), row.total]),
	);
	const daily = Array.from({ length: daysInMonth }, (_, i) => ({
		day: i + 1,
		total: byDay.get(i + 1) ?? 0,
	}));

	const daysCounted =
		month === currentMonth
			? Number(wibDate(now).slice(8))
			: month < currentMonth
				? daysInMonth
				: 0;

	return c.html(
		<DashboardPage
			month={month}
			label={monthLabel(month)}
			prevMonth={prevMonth}
			prevLabel={monthLabel(prevMonth)}
			nextMonth={shiftMonth(month, 1)}
			total={total}
			prevTotal={prevTotal}
			averagePerDay={daysCounted > 0 ? Math.round(total / daysCounted) : null}
			daily={daily}
			categories={categories}
			categoryFilter={categoryFilter}
			categoryOptions={categoryOptions}
			expenses={expenses}
		/>,
	);
});

function csvField(value: string | number): string {
	const text = String(value);
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

dashboard.get("/export.csv", (c) => {
	const monthParam = c.req.query("month") ?? "";
	const month = MONTH.test(monthParam) ? monthParam : wibMonth(new Date());
	const expenses = listExpenses(
		c.env.DB,
		monthRange(month),
		c.req.query("category") || null,
	).reverse();

	const rows = [
		["Tanggal", "Keterangan", "Kategori", "Nominal"],
		...expenses.map((e) => [e.spent_on, e.description, e.category, e.amount]),
	];
	const body = rows.map((row) => `${row.map(csvField).join(",")}\r\n`).join("");
	return c.body(`${UTF8_BOM}${body}`, 200, {
		"Content-Type": "text/csv; charset=utf-8",
		"Content-Disposition": `attachment; filename="spendchat-${month}.csv"`,
	});
});

dashboard.post("/expenses/:id", async (c) => {
	const form = await c.req.parseBody();
	const amount = Number(field(form, "amount"));
	const description = field(form, "description");
	const category = field(form, "category");
	const spentOn = field(form, "spent_on");
	if (
		!Number.isInteger(amount) ||
		amount <= 0 ||
		!description ||
		!category ||
		!DATE.test(spentOn)
	) {
		return c.text("Data tidak valid", 400);
	}
	updateExpense(c.env.DB, Number(c.req.param("id")), {
		amount,
		description,
		category,
		spentOn,
	});
	return c.redirect(`/dashboard?month=${spentOn.slice(0, 7)}`);
});

dashboard.post("/expenses/:id/delete", async (c) => {
	const form = await c.req.parseBody();
	const month = field(form, "month");
	deleteExpense(c.env.DB, Number(c.req.param("id")));
	return c.redirect(
		MONTH.test(month) ? `/dashboard?month=${month}` : "/dashboard",
	);
});
