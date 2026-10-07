const rupiah = new Intl.NumberFormat("id-ID");

export function formatRupiah(amount: number): string {
	return `Rp${rupiah.format(amount)}`;
}
