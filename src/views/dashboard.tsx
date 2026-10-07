import type { CategoryTotal, Expense } from "../db";
import { formatRupiah } from "../money";
import { Layout } from "./layout";

export type DashboardData = {
	month: string;
	label: string;
	prevMonth: string;
	prevLabel: string;
	nextMonth: string;
	total: number;
	prevTotal: number;
	averagePerDay: number | null;
	daily: { day: number; total: number }[];
	categories: CategoryTotal[];
	categoryFilter: string | null;
	categoryOptions: string[];
	expenses: Expense[];
};

const SHORT_MONTH = new Intl.DateTimeFormat("id-ID", {
	month: "short",
	timeZone: "UTC",
});

function shortMonth(month: string): string {
	return SHORT_MONTH.format(new Date(`${month}-01T00:00:00Z`));
}

function Comparison({
	total,
	prevTotal,
	prevLabel,
}: {
	total: number;
	prevTotal: number;
	prevLabel: string;
}) {
	const diff = total - prevTotal;
	if (diff === 0) return <p class="secondary">Sama dengan {prevLabel}</p>;
	return (
		<p class={diff > 0 ? "up" : "down"}>
			{diff > 0 ? "▲" : "▼"} {formatRupiah(Math.abs(diff))}{" "}
			{diff > 0 ? "lebih banyak" : "lebih sedikit"} dari {prevLabel}
		</p>
	);
}

function DailyBars({
	month,
	label,
	daily,
}: {
	month: string;
	label: string;
	daily: DashboardData["daily"];
}) {
	const max = Math.max(...daily.map((d) => d.total));
	const monthShort = shortMonth(month);
	return (
		<div class="card">
			<h2 class="secondary">Per hari</h2>
			<div class="daily" role="img" aria-label={`Pengeluaran harian ${label}`}>
				{daily.map((d) => (
					<div
						class="day"
						tabindex={0}
						data-tip={`${d.day} ${monthShort}: ${formatRupiah(d.total)}`}
					>
						<span
							class="bar"
							style={`height:${max > 0 ? (d.total / max) * 100 : 0}%`}
						/>
					</div>
				))}
			</div>
			<div class="axis muted num">
				<span>1</span>
				<span>{daily.length}</span>
			</div>
		</div>
	);
}

function CategoryBars({
	month,
	categories,
	categoryFilter,
}: Pick<DashboardData, "month" | "categories" | "categoryFilter">) {
	if (categories.length === 0) return null;
	const max = categories[0].total;
	return (
		<div class="card">
			<h2 class="secondary">Per kategori</h2>
			<ul class="cats">
				{categories.map((cat) => {
					const active = cat.category === categoryFilter;
					const href = active
						? `/dashboard?month=${month}`
						: `/dashboard?month=${month}&category=${encodeURIComponent(cat.category)}`;
					return (
						<li>
							<a href={href} aria-current={active ? "true" : undefined}>
								<span class="cat-name">{cat.category}</span>
								<span class="num">{formatRupiah(cat.total)}</span>
								<span class="track">
									<span
										class="fill"
										style={`width:${(cat.total / max) * 100}%`}
									/>
								</span>
							</a>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function ExpenseRow({ expense, month }: { expense: Expense; month: string }) {
	return (
		<tr>
			<td class="num muted">{Number(expense.spent_on.slice(8))}</td>
			<td>
				{expense.description}
				<div class="muted">{expense.category}</div>
				<details>
					<summary>Ubah</summary>
					<form method="post" action={`/expenses/${expense.id}`} class="stack">
						<input
							name="amount"
							type="number"
							min="1"
							step="1"
							required
							value={String(expense.amount)}
						/>
						<input name="description" required value={expense.description} />
						<input
							name="category"
							list="category-options"
							required
							value={expense.category}
						/>
						<input
							name="spent_on"
							type="date"
							required
							value={expense.spent_on}
						/>
						<button type="submit">Simpan</button>
					</form>
					<form
						method="post"
						action={`/expenses/${expense.id}/delete`}
						class="stack"
						onsubmit="return confirm('Hapus pengeluaran ini?')"
					>
						<input type="hidden" name="month" value={month} />
						<button type="submit" class="danger">
							Hapus
						</button>
					</form>
				</details>
			</td>
			<td class="amount num">{formatRupiah(expense.amount)}</td>
		</tr>
	);
}

export function DashboardPage(data: DashboardData) {
	return (
		<Layout title={`${data.label} · SpendChat`}>
			<nav>
				<a
					class="arrow"
					href={`/dashboard?month=${data.prevMonth}`}
					aria-label="Bulan sebelumnya"
				>
					‹
				</a>
				<h1>{data.label}</h1>
				<a
					class="arrow"
					href={`/dashboard?month=${data.nextMonth}`}
					aria-label="Bulan berikutnya"
				>
					›
				</a>
			</nav>

			<div class="card">
				<div class="muted">Total</div>
				<div class="hero">{formatRupiah(data.total)}</div>
				<Comparison
					total={data.total}
					prevTotal={data.prevTotal}
					prevLabel={data.prevLabel}
				/>
				<div class="stats">
					<div>
						<div class="muted">Rata-rata per hari</div>
						<div class="num">
							{data.averagePerDay === null
								? "—"
								: formatRupiah(data.averagePerDay)}
						</div>
					</div>
					<div>
						<div class="muted">Transaksi</div>
						<div class="num">{data.expenses.length}</div>
					</div>
				</div>
			</div>

			<DailyBars month={data.month} label={data.label} daily={data.daily} />
			<CategoryBars
				month={data.month}
				categories={data.categories}
				categoryFilter={data.categoryFilter}
			/>

			<div class="card">
				<h2 class="secondary">
					Transaksi{data.categoryFilter && ` · ${data.categoryFilter}`}
					{data.categoryFilter && (
						<>
							{" "}
							<a href={`/dashboard?month=${data.month}`}>semua</a>
						</>
					)}
				</h2>
				<datalist id="category-options">
					{data.categoryOptions.map((category) => (
						<option value={category} />
					))}
				</datalist>
				{data.expenses.length === 0 ? (
					<p class="muted">Belum ada catatan.</p>
				) : (
					<table>
						<thead>
							<tr>
								<th>Tgl</th>
								<th>Keterangan</th>
								<th class="amount">Nominal</th>
							</tr>
						</thead>
						<tbody>
							{data.expenses.map((expense) => (
								<ExpenseRow expense={expense} month={data.month} />
							))}
						</tbody>
					</table>
				)}
			</div>

			<p>
				<a href="/categories">Atur kategori</a>
			</p>
		</Layout>
	);
}
