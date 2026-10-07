# SpendChat

Personal expense tracker: log expenses by chatting a WhatsApp bot, review them in a web dashboard. Runs on Cloudflare Workers + D1.

## Chat usage

| Send | Result |
|---|---|
| `bensin 50` | Rp50.000 · Transport |
| `makan 20` | Rp20.000 · "makan siang" (time of day added automatically) |
| `kopi 18k #jajan` | Rp18.000 · category Jajan, remembered for "kopi" |
| `kemarin parkir 5rb` / `yesterday parkir 5rb` | dated yesterday |
| several lines | one expense per line |
| `hari ini` / `minggu ini` / `bulan ini` (or `today` / `this week` / `this month`) | summary |
| `hapus` / `undo` | undo the last message |
| `dashboard` | one-time login link |
| `bantuan` / `help` | help |

Bare numbers below 1000 mean thousands: `50` = Rp50.000.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

To run `pnpm dev` locally, copy `.dev.vars.example` to `.dev.vars`, fill it in, and create the local database with `pnpm wrangler d1 migrations apply spendchat --local`.

## Deploy

1. `pnpm wrangler login`
2. `pnpm wrangler d1 create spendchat` and put the printed `database_id` into `wrangler.jsonc`.
3. `pnpm wrangler d1 migrations apply spendchat --remote`
4. `pnpm run deploy` once to get the Worker URL (`https://spendchat.<subdomain>.workers.dev`), set it as `BASE_URL` in `wrangler.jsonc`, and deploy again.
5. Set secrets (each command prompts for the value):
   ```bash
   pnpm wrangler secret put WA_ACCESS_TOKEN
   pnpm wrangler secret put WA_APP_SECRET
   pnpm wrangler secret put WA_VERIFY_TOKEN
   pnpm wrangler secret put WA_PHONE_NUMBER_ID
   pnpm wrangler secret put OWNER_WA_NUMBER
   pnpm wrangler secret put SESSION_SECRET
   ```
   - `WA_VERIFY_TOKEN`, `SESSION_SECRET`: any long random strings you choose (e.g. `openssl rand -hex 32`).
   - `OWNER_WA_NUMBER`: your personal number in international format without `+`, e.g. `6281234567890`.

## WhatsApp Cloud API setup

1. At developers.facebook.com create an app of type **Business** and add the **WhatsApp** product.
2. Under WhatsApp → API Setup, add the bot's phone number. It must not be registered in the WhatsApp or WhatsApp Business app; delete that account from the app first. Note the **Phone number ID** → `WA_PHONE_NUMBER_ID`.
3. App Settings → Basic → **App secret** → `WA_APP_SECRET`.
4. In Business Settings create a **System User**, assign the app and the WhatsApp account, and generate a token with `whatsapp_business_messaging` and `whatsapp_business_management` → `WA_ACCESS_TOKEN`. The temporary token on the API Setup page expires in 24 hours; don't use it.
5. WhatsApp → Configuration → Webhook: callback URL `https://<your-worker>/webhook`, verify token = `WA_VERIFY_TOKEN`. Then subscribe to the **messages** field.
6. From your personal number, send `bantuan` to the bot's number.

Logs: `pnpm wrangler tail`.
