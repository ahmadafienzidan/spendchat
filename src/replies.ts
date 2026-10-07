import type { CategoryTotal, Expense } from "./db";
import { formatRupiah } from "./money";
import { isExpense, type ParsedLine, type SkippedLine } from "./parser";

export const HELP_TEXT = [
	"Cara mencatat: tulis keterangan + nominal.",
	"• bensin 50 → Rp50.000",
	"• kopi 18k #jajan → kategori Jajan",
	"• kemarin parkir 5rb → dicatat ke kemarin",
	"Bisa banyak baris sekaligus, satu baris satu pengeluaran.",
	"",
	"Perintah: hari ini · minggu ini · bulan ini · hapus · dashboard · bantuan",
	"English: today · this week · this month · undo · help · yesterday",
].join("\n");

export const NON_TEXT_REPLY = "Aku cuma bisa baca teks 🙏";

const SKIP_REASONS: Record<SkippedLine["reason"], string> = {
	no_amount: "tidak ada nominal",
	no_description: "tidak ada keterangan",
};

function expenseText(expense: {
	amount: number;
	description: string;
	category: string;
}): string {
	return `${formatRupiah(expense.amount)} · ${expense.description} · ${expense.category}`;
}

export function expensesReply(lines: ParsedLine[], todayTotal: number): string {
	const saved = lines.filter(isExpense);
	const skipped = lines
		.filter((line): line is SkippedLine => !line.ok)
		.map((line) => `⚠️ Dilewati: "${line.line}" (${SKIP_REASONS[line.reason]})`);

	if (saved.length === 0)
		return skipped.length ? `${skipped.join("\n")}\n\n${HELP_TEXT}` : HELP_TEXT;

	const savedText =
		saved.length === 1
			? [`✅ ${expenseText(saved[0])}`]
			: [
					`✅ ${saved.length} dicatat`,
					...saved.map((expense) => `• ${expenseText(expense)}`),
				];
	return [
		...savedText,
		...skipped,
		`Hari ini: ${formatRupiah(todayTotal)}`,
	].join("\n");
}

export function summaryReply(title: string, totals: CategoryTotal[]): string {
	if (totals.length === 0)
		return `📊 ${title}: ${formatRupiah(0)}\nBelum ada catatan.`;
	const total = totals.reduce((sum, row) => sum + row.total, 0);
	return [
		`📊 ${title}: ${formatRupiah(total)}`,
		...totals.map((row) => `• ${row.category}: ${formatRupiah(row.total)}`),
	].join("\n");
}

export function undoReply(deleted: Expense[]): string {
	if (deleted.length === 0) return "Belum ada catatan.";
	return [
		"🗑️ Dihapus:",
		...deleted.map((expense) => `• ${expenseText(expense)}`),
	].join("\n");
}

export function loginReply(url: string): string {
	return `🔐 Link dashboard (berlaku 10 menit, sekali pakai):\n${url}`;
}
