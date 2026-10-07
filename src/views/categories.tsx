import type { Keyword } from "../parser";
import { Layout } from "./layout";

export function CategoriesPage({
	keywords,
	categoryOptions,
}: {
	keywords: Keyword[];
	categoryOptions: string[];
}) {
	const groups = new Map<string, string[]>();
	for (const { keyword, category } of keywords) {
		groups.set(category, [...(groups.get(category) ?? []), keyword]);
	}

	return (
		<Layout title="Kategori · SpendChat">
			<nav>
				<a href="/dashboard">‹ Dashboard</a>
				<h1>Kategori</h1>
				<span />
			</nav>

			<div class="card">
				<h2 class="secondary">Tambah / ubah kata kunci</h2>
				<form method="post" action="/categories" class="stack">
					<input
						name="keyword"
						placeholder="kata kunci, mis. netflix"
						required
					/>
					<input
						name="category"
						list="category-options"
						placeholder="kategori, mis. Hiburan"
						required
					/>
					<datalist id="category-options">
						{categoryOptions.map((category) => (
							<option value={category} />
						))}
					</datalist>
					<button type="submit">Simpan</button>
				</form>
			</div>

			{[...groups].map(([category, words]) => (
				<div class="card">
					<h2>{category}</h2>
					<table class="keywords">
						<tbody>
							{words.map((keyword) => (
								<tr>
									<td>{keyword}</td>
									<td class="amount">
										<form
											method="post"
											action="/categories/delete"
											class="inline"
										>
											<input type="hidden" name="keyword" value={keyword} />
											<button type="submit" class="danger">
												Hapus
											</button>
										</form>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			))}
		</Layout>
	);
}
