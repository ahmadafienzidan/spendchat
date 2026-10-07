import { Layout } from "./layout";

export function LoginPage({
	token,
	error,
}: {
	token: string | null;
	error?: string;
}) {
	return (
		<Layout title="Masuk · SpendChat">
			<div class="card">
				<h1>SpendChat</h1>
				{error && <p class="error">{error}</p>}
				{token ? (
					<form method="post" action="/login" class="stack">
						<input type="hidden" name="token" value={token} />
						<button type="submit">Masuk</button>
					</form>
				) : (
					<p class="secondary">
						Ketik <b>dashboard</b> di WhatsApp untuk dapat link masuk.
					</p>
				)}
			</div>
		</Layout>
	);
}
