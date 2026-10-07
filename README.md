# SpendChat

Personal expense tracker: log expenses by chatting a WhatsApp bot, review them in a web dashboard. Runs as a Node.js service with SQLite on a small VPS.

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

## Try it locally (no WhatsApp needed)

1. Copy `.env.example` to `.env` and fill every value; dummy values are fine locally (e.g. `WA_ACCESS_TOKEN=dev`). Keep `BASE_URL=http://localhost:3000`.
2. `mkdir .data`
3. `pnpm dev` starts the app on `http://127.0.0.1:3000`.
4. In another terminal, chat with the bot. Each argument is one line of the same message:

   ```bash
   pnpm chat "bensin 50" "makan 20"
   pnpm chat "hari ini"
   pnpm chat dashboard
   ```

   `pnpm chat` runs the same bot logic against `.data/spendchat.db` and prints the reply instead of sending it to WhatsApp.
5. Open the link from `pnpm chat dashboard` in your browser and press **Masuk**.

## Server setup (Ubuntu 24.04 VPS)

Prerequisites: a VPS reachable over SSH as root with your key, and a DNS `A` record `spendchat.<domain>` pointing at its IP.

As root on the VPS:

```bash
apt update && apt upgrade -y
apt install -y curl git sqlite3 ufw debian-keyring debian-archive-keyring apt-transport-https gnupg

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
corepack enable

curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

useradd --system --home-dir /opt/spendchat --shell /usr/sbin/nologin spendchat
git clone https://github.com/ahmadafienzidan/spendchat.git /opt/spendchat
chown -R spendchat: /opt/spendchat
install -d -o spendchat -g spendchat -m 700 /var/lib/spendchat /var/lib/spendchat/backups

cd /opt/spendchat
sudo -u spendchat env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile
sudo -u spendchat pnpm build
```

Environment file (replace `<domain>`; `SESSION_SECRET` is generated here):

```bash
install -m 600 /dev/null /etc/spendchat.env
cat > /etc/spendchat.env <<EOF
PORT=3000
DATABASE_PATH=/var/lib/spendchat/spendchat.db
BASE_URL=https://spendchat.<domain>
SESSION_SECRET=$(openssl rand -hex 32)
OWNER_WA_NUMBER=
WA_ACCESS_TOKEN=
WA_APP_SECRET=
WA_VERIFY_TOKEN=
WA_PHONE_NUMBER_ID=
EOF
```

Fill the empty values yourself with `nano /etc/spendchat.env` (see WhatsApp setup below). `OWNER_WA_NUMBER` is your personal number without `+`, e.g. `6281234567890`; `WA_VERIFY_TOKEN` is any long random string you choose.

HTTPS and services:

```bash
cat > /etc/caddy/Caddyfile <<EOF
spendchat.<domain> {
	reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy

cp /opt/spendchat/deploy/spendchat.service /opt/spendchat/deploy/spendchat-backup.service /opt/spendchat/deploy/spendchat-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now spendchat-backup.timer
systemctl enable --now spendchat
```

Start `spendchat` only after the environment file is complete; with an empty value it exits with `Missing environment variables: …`.

Check: `systemctl status spendchat`, `curl -I https://spendchat.<domain>/login` (200).

## Updating

```bash
cd /opt/spendchat
sudo -u spendchat git pull
sudo -u spendchat pnpm install --frozen-lockfile
sudo -u spendchat pnpm build
systemctl restart spendchat
```

Migrations run automatically on start.

## Backups

Daily at 03:00 WIB into `/var/lib/spendchat/backups/spendchat-YYYY-MM-DD.db`, kept 14 days. Run one now with `systemctl start spendchat-backup.service`.

To restore: `systemctl stop spendchat`, copy a backup over `/var/lib/spendchat/spendchat.db` (owner `spendchat`), delete any `spendchat.db-wal` and `spendchat.db-shm` next to it, then `systemctl start spendchat`.

## WhatsApp Cloud API setup

1. At developers.facebook.com create an app of type **Business** and add the **WhatsApp** product.
2. Under WhatsApp → API Setup, add the bot's phone number. It must not be registered in the WhatsApp or WhatsApp Business app; delete that account from the app first. Note the **Phone number ID** → `WA_PHONE_NUMBER_ID`.
3. App Settings → Basic → **App secret** → `WA_APP_SECRET`.
4. In Business Settings create a **System User**, assign the app and the WhatsApp account, and generate a token with `whatsapp_business_messaging` and `whatsapp_business_management` → `WA_ACCESS_TOKEN`. The temporary token on the API Setup page expires in 24 hours; don't use it.
5. After filling `/etc/spendchat.env`: `systemctl restart spendchat`.
6. WhatsApp → Configuration → Webhook: callback URL `https://spendchat.<domain>/webhook`, verify token = `WA_VERIFY_TOKEN`. Then subscribe to the **messages** field.
7. From your personal number, send `bantuan` to the bot's number.

Logs: `journalctl -u spendchat -f`.
