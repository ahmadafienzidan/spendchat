# SpendChat — Design

**SpendChat** is a personal expense tracker for one person. Expenses are logged by sending short messages to a WhatsApp bot; a web dashboard shows, corrects, and categorizes them.

- **Status:** design approved in chat on 2026-10-01; implementation plan in `docs/superpowers/plans/2026-10-01-spendchat.md`. Not implemented yet.
- **Owner:** the only user. "Owner" below always means the owner's personal WhatsApp number.
- **Names:** product name `SpendChat`; technical name `spendchat` (repo folder, Worker, D1 database, package).
- **Language:** chat commands in Indonesian or English; bot replies and dashboard UI in Indonesian; code and docs in English.

## 1. Goals and non-goals

### Goals

1. Log an expense in one short message: `bensin 50`.
2. Log several expenses in one message, one per line.
3. Get today / this week / this month summaries in the chat.
4. Undo a wrong message from the chat.
5. Review, correct, and categorize expenses in a mobile-friendly dashboard.

### Non-goals (v1)

Budgets, income, CSV export, multiple users or households, currencies other than rupiah, photos / voice notes / receipts, AI parsing, reminders or scheduled messages from the bot, editing past messages in WhatsApp.

`expenses.sender` stores the sender number so a shared household mode can be added later without a migration.

## 2. How it is used

### Daily flow

```
Owner (personal WhatsApp)          Bot number (Cloud API)            Worker + D1
─────────────────────────          ──────────────────────            ───────────
"bensin 50\nmakan 20"   ─────────▶ Meta sends webhook  ────────────▶ verify signature
                                                                      check sender = owner
                                                                      skip if already processed
                                                                      parse → save → build reply
"✅ 2 dicatat ..."       ◀───────── Graph API send      ◀──────────── sendText
```

### Dashboard flow

```
Owner: "dashboard" ──▶ bot replies with https://<worker>/login?t=<token>   (valid 10 min, single use)
Owner taps link    ──▶ page with a "Masuk" button
Owner taps Masuk   ──▶ token consumed, 30-day session cookie set, redirect to /dashboard
```

Within 30 days the owner can open `/dashboard` directly (bookmark or the old link's page) without a new token.

## 3. Prerequisites and cost

| Need | Detail |
|---|---|
| Bot phone number | A spare number that is **not** registered in the WhatsApp or WhatsApp Business app (delete that account first). Meta's free test number can be used while developing. |
| Meta developer app | Type **Business**, with the WhatsApp product. |
| Permanent access token | From a **System User** in Meta Business Settings. The token on the API Setup page expires after 24 hours. |
| Cloudflare account | Free plan is enough: Workers + D1. |

Cost for one person's usage is expected to be zero: the bot only replies to the owner's messages, so every reply falls inside WhatsApp's free 24-hour customer-service window, and usage stays far below Workers and D1 free limits.

## 4. Architecture

One Cloudflare Worker (TypeScript, Hono) with one D1 (SQLite) database. No other services.

### Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /webhook` | verify token | Meta verification handshake: if `hub.mode=subscribe` and `hub.verify_token` matches, return `hub.challenge`; else 403 |
| `POST /webhook` | Meta signature | Incoming WhatsApp events |
| `GET /login?t=` | — | Page with a "Masuk" button (does not consume the token) |
| `POST /login` | token | Consume token, set session, redirect to `/dashboard` |
| `GET /` | — | Redirect to `/dashboard` |
| `GET /dashboard?month=YYYY-MM&category=` | session | Month overview, charts, transaction table |
| `POST /expenses/:id` | session | Edit an expense |
| `POST /expenses/:id/delete` | session | Delete an expense |
| `GET /categories` | session | Keyword → category list |
| `POST /categories` | session | Add or change a keyword |
| `POST /categories/delete` | session | Delete a keyword |

Pages are server-rendered with Hono JSX and plain HTML forms. Charts are HTML/CSS bars. The only client-side script is the browser's `confirm()` before deleting. No frontend build step.

### Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `time` | WIB dates/hours, day/week/month ranges, Indonesian month labels | — |
| `money` | `Rp` formatting | — |
| `parser` | Pure: text + message time + keywords → command or parsed lines | `time` |
| `crypto` | HMAC sign/verify, random tokens | Web Crypto |
| `db` | All D1 queries | `crypto` |
| `whatsapp` | Signature check, payload extraction, `sendText` | `crypto` |
| `replies` | Reply text builders | `money` |
| `bot` | One incoming message → DB changes + reply text | `parser`, `db`, `replies`, `time` |
| `auth` | Session cookie, `requireSession` middleware | `crypto` |
| `routes/*`, `views/*` | Thin HTTP handlers and JSX pages | all of the above |

### Configuration

| Name | Kind | Value |
|---|---|---|
| `DB` | D1 binding | database `spendchat` |
| `BASE_URL` | var | Worker URL, used in the login link, e.g. `https://spendchat.<sub>.workers.dev` |
| `WA_ACCESS_TOKEN` | secret | System User token |
| `WA_APP_SECRET` | secret | Meta app secret, for webhook signatures |
| `WA_VERIFY_TOKEN` | secret | Random string, also entered in Meta's webhook settings |
| `WA_PHONE_NUMBER_ID` | secret | Bot number's Phone number ID |
| `OWNER_WA_NUMBER` | secret | Owner number, international format without `+`, e.g. `6281234567890` |
| `SESSION_SECRET` | secret | Random string for signing session cookies |

## 5. Data model (D1)

```sql
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  amount INTEGER NOT NULL CHECK (amount > 0),   -- rupiah
  description TEXT NOT NULL,                    -- as typed, after parsing
  category TEXT NOT NULL,
  spent_on TEXT NOT NULL,                       -- 'YYYY-MM-DD' in WIB
  sender TEXT NOT NULL,                         -- WhatsApp number
  wa_message_id TEXT NOT NULL,                  -- groups lines of one message (for `hapus`)
  line_no INTEGER NOT NULL,                     -- 1-based, among non-empty lines
  created_at TEXT NOT NULL,                     -- ISO 8601 UTC
  UNIQUE (wa_message_id, line_no)
);
CREATE INDEX expenses_spent_on ON expenses (spent_on);

CREATE TABLE category_keywords (
  keyword TEXT PRIMARY KEY,                     -- lowercase word or phrase
  category TEXT NOT NULL
);

CREATE TABLE login_tokens (
  token TEXT PRIMARY KEY,                       -- 64 hex chars
  expires_at TEXT NOT NULL,                     -- ISO 8601 UTC
  used_at TEXT                                  -- NULL until consumed
);

CREATE TABLE processed_messages (
  wa_message_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);
```

Categories are free text: a category exists as soon as a keyword or an expense uses it. There is no separate categories table.

### Seed keywords

| Category | Keywords |
|---|---|
| Makan | makan, sarapan, kopi, nasi, minum, snack, jajan |
| Transport | bensin, grab, gojek, ojek, parkir, tol, krl, bus |
| Laundry | cuci, laundry |
| Belanja | belanja, indomaret, alfamart |
| Tagihan | listrik, pulsa, internet, wifi, pdam |
| Kesehatan | obat, dokter |

Anything unmatched → `Lainnya`.

## 6. Time

- All dates and hours are WIB (UTC+7, no daylight saving).
- The reference time for a message is its WhatsApp `timestamp` (when the owner sent it), not when the Worker received it. A message sent at 23:59 and delivered at 00:01 counts for the earlier day.
- "This week" is Monday–Sunday. "This month" is the calendar month.

## 7. Chat behavior

### 7.1 Commands

Commands are accepted in Indonesian and English. Replies are always Indonesian.

A message is a command only if its **whole text**, trimmed, lowercased, and with repeated spaces collapsed, is one of:

| Indonesian | English | Effect | Reply |
|---|---|---|---|
| `hari ini` | `today` | — | Today's total and per-category totals |
| `minggu ini` | `this week` | — | Same for this Monday–Sunday |
| `bulan ini` | `this month` | — | Same for this month, titled with the month name |
| `hapus` | `undo` | Deletes all expenses from the most recently saved message | List of deleted expenses, or `Belum ada catatan.` |
| `dashboard` | `dashboard` | Creates a login token | Login link |
| `bantuan` | `help` | — | Help text |

`hari ini makan 20` and `today makan 20` are **not** commands; they are parsed as expenses (description "hari ini makan" / "today makan", Rp20.000).

`hapus` / `undo` can be repeated: each call removes the next most recent message's expenses. It looks at the most recently inserted row, so dashboard edits do not change what it removes.

### 7.2 Expense parsing

The message is split on newlines. Empty lines are ignored. Each remaining line is one expense, numbered from 1.

Per line, in this order:

1. **Yesterday.** If the first word is `kemarin` or `yesterday` (any case), remove it; the expense is dated yesterday. Below, "a `kemarin` line" covers both words.
2. **Tag.** A word of the form `#something` sets the category to `Something` (first letter uppercase, rest lowercase) and is removed. If several tags appear, the last one wins.
3. **Amount.** The first word matching `^\d+([.,]\d+)*(rb|ribu|k|jt|juta)?$` (case-insensitive) is the amount and is removed. Later numbers stay in the description.
   - With a suffix, `.` or `,` is a **decimal** point: `rb`/`ribu`/`k` ×1.000, `jt`/`juta` ×1.000.000.
   - Without a suffix, `.` and `,` are **thousands** separators.
   - Without a suffix and below 1000, the value is multiplied by 1000.
   - The result is rounded to whole rupiah and must be > 0; otherwise the word is not an amount.
4. **Description.** The remaining words joined by single spaces, in the original casing.
5. **Meal time.** If the line is not `kemarin` and the description (lowercased) is exactly `makan`, it becomes `makan pagi` / `makan siang` / `makan sore` / `makan malam` by the WIB hour the message was sent:

   | Hour | Description |
   |---|---|
   | 04:00–10:59 | makan pagi |
   | 11:00–14:59 | makan siang |
   | 15:00–17:59 | makan sore |
   | 18:00–03:59 | makan malam |

6. **Category.** The tag if present. Otherwise the keyword from `category_keywords` that appears in the lowercased description as a whole word or phrase; if several match, the longest keyword wins. Otherwise `Lainnya`.
7. **Remember tag.** If a tag was used, `category_keywords` gets `(description lowercased → category)`, replacing any existing entry for that phrase.

A line is **skipped** (not saved, reported in the reply) when it has no amount or no description left.

### 7.3 Amount examples

| Typed | Rupiah |
|---|---|
| `50` | 50.000 |
| `7` | 7.000 |
| `999` | 999.000 |
| `1000` | 1.000 |
| `25000`, `25.000`, `25,000` | 25.000 |
| `25rb`, `25ribu`, `25k`, `25K` | 25.000 |
| `2.5k`, `2,5rb` | 2.500 |
| `1.5jt`, `1,5jt` | 1.500.000 |
| `2juta` | 2.000.000 |
| `0`, `0rb`, `12abc`, `1.500.000jt` | not an amount |

Known trade-off: an amount under Rp1.000 cannot be entered from the chat (`500` means Rp500.000). It can be corrected in the dashboard.

### 7.4 Line examples (message sent 12:00 WIB, Thursday 1 Oct 2026)

| Line | Amount | Description | Category | Date |
|---|---|---|---|---|
| `bensin 50` | 50.000 | bensin | Transport | 1 Oct |
| `makan 20` | 20.000 | makan siang | Makan | 1 Oct |
| `Makan 20` | 20.000 | makan siang | Makan | 1 Oct |
| `sarapan 10` | 10.000 | sarapan | Makan | 1 Oct |
| `makan pagi 7` | 7.000 | makan pagi | Makan | 1 Oct |
| `cuci 18` | 18.000 | cuci | Laundry | 1 Oct |
| `kopi 18k #jajan` | 18.000 | kopi | Jajan (and "kopi" → Jajan from now on) | 1 Oct |
| `kemarin makan 20` | 20.000 | makan | Makan | 30 Sep |
| `kemarin parkir 5rb` | 5.000 | parkir | Transport | 30 Sep |
| `yesterday parkir 5rb` | 5.000 | parkir | Transport | 30 Sep |
| `sewa kos 1.5jt` | 1.500.000 | sewa kos | Lainnya | 1 Oct |
| `beli 2 tiket 3` | 2.000 | beli tiket 3 | Lainnya | 1 Oct |
| `pencucian 20` | 20.000 | pencucian | Lainnya (keywords match whole words only) | 1 Oct |
| `makan siang` | — | skipped: no amount | — | — |
| `50` | — | skipped: no description | — | — |

### 7.5 Replies (exact text)

One expense saved:

```
✅ Rp18.000 · kopi · Makan
Hari ini: Rp143.000
```

Several saved, some skipped:

```
✅ 2 dicatat
• Rp50.000 · bensin · Transport
• Rp20.000 · makan siang · Makan
⚠️ Dilewati: "makan siang" (tidak ada nominal)
Hari ini: Rp70.000
```

`Hari ini` is today's total after saving, so `kemarin` entries do not change it.

Nothing saved: the skipped lines (if any), a blank line, then the help text.

Skip reasons: `tidak ada nominal` (no amount), `tidak ada keterangan` (no description).

Summary (categories by total, largest first; ties alphabetical):

```
📊 Oktober 2026: Rp1.600.000
• Makan: Rp980.000
• Transport: Rp620.000
```

Titles: `Hari ini`, `Minggu ini`, or the month name (`Oktober 2026`). With no data: `📊 Hari ini: Rp0` then `Belum ada catatan.`

Undo:

```
🗑️ Dihapus:
• Rp50.000 · bensin · Transport
• Rp18.000 · cuci · Laundry
```

Login link:

```
🔐 Link dashboard (berlaku 10 menit, sekali pakai):
https://spendchat.<sub>.workers.dev/login?t=<64 hex chars>
```

Help:

```
Cara mencatat: tulis keterangan + nominal.
• bensin 50 → Rp50.000
• kopi 18k #jajan → kategori Jajan
• kemarin parkir 5rb → dicatat ke kemarin
Bisa banyak baris sekaligus, satu baris satu pengeluaran.

Perintah: hari ini · minggu ini · bulan ini · hapus · dashboard · bantuan
English: today · this week · this month · undo · help · yesterday
```

Non-text message (photo, voice note, sticker, location…): `Aku cuma bisa baca teks 🙏`

Amounts always use `Rp` + Indonesian thousands separators (`Rp1.500.000`).

## 8. Webhook handling

For each `POST /webhook`:

1. Verify `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(raw body, `WA_APP_SECRET`). Invalid or missing → **401**, nothing processed.
2. Extract messages from `entry[].changes[].value.messages[]`. Events without messages (delivered/read statuses) → **200**, nothing else.
3. For each message:
   1. Sender ≠ `OWNER_WA_NUMBER` → ignore silently.
   2. `wa_message_id` already in `processed_messages` → ignore (Meta re-delivered it).
   3. Handle it (section 7) and send the reply with `preview_url: false`.
4. Return **200**.

### Idempotency

Meta re-delivers a webhook if it does not get a 200 quickly. Every message that **writes** records its id in `processed_messages` inside the same D1 batch (one transaction) as the write:

| Message | Written together |
|---|---|
| Expenses (≥ 1 line saved) | expense rows + remembered tags + processed marker |
| `hapus` / `undo` (something to delete) | delete + processed marker |
| `dashboard` | login token + processed marker |

So a re-delivered message can never insert twice or undo a second message. Messages that write nothing (summaries, help, all lines skipped, non-text) are simply answered again on re-delivery.

### Failures

No defensive try/catch. If D1 or the Graph API fails, the request returns 500, the error appears in `wrangler tail`, and Meta re-delivers. If the data was already committed but the reply failed, the re-delivery is ignored by the marker: data stays correct, the owner just gets no confirmation for that message.

### Error matrix

| Situation | HTTP | Data | Reply |
|---|---|---|---|
| Bad signature | 401 | — | — |
| Status event | 200 | — | — |
| Unknown sender | 200 | — | — |
| Duplicate delivery of a writing message | 200 | unchanged | — |
| Non-text message | 200 | — | "Aku cuma bisa baca teks 🙏" |
| Graph API send fails | 500 | kept | none (Meta retries, marker skips it) |
| D1 fails | 500 | rolled back | none (Meta retries and it is processed then) |

## 9. Dashboard

### 9.1 Login and session

- Token: 32 random bytes as hex, valid 10 minutes, single use.
- `GET /login?t=…` only shows a **Masuk** button, so link previewers or prefetchers that open the URL cannot use up the token. `POST /login` consumes it.
- Invalid, expired, or used token → 401 page: "Link sudah kedaluwarsa atau sudah dipakai. Ketik dashboard di WhatsApp untuk minta link baru."
- `GET /login` without a token → "Ketik **dashboard** di WhatsApp untuk dapat link masuk."
- Session cookie `session=<expiresAtMs>.<hmac>`: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=30 days`, signed with `SESSION_SECRET`. No server-side session table. Changing `SESSION_SECRET` logs out every browser.
- Protected routes without a valid session → 302 to `/login`.
- `SameSite=Lax`: cross-site form POSTs carry no cookie (CSRF protection), but the cookie is sent when the dashboard is opened from a link, e.g. in WhatsApp.

### 9.2 Dashboard page (`/dashboard`)

Query: `month=YYYY-MM` (invalid or missing → current WIB month), `category=` (optional filter for the table).

```
┌───────────────────────────────┐
│ ‹      Oktober 2026         › │  prev / next month
├───────────────────────────────┤
│ Total                         │
│ Rp2.340.000                   │
│ ▲ Rp300.000 lebih banyak dari │  vs previous month
│   September 2026              │
│ Rata-rata per hari  Transaksi │
│ Rp78.000            57        │
├───────────────────────────────┤
│ Per hari                      │
│ ▁▃▂▅▁ ▇▂▃▁▂ ...               │  one bar per day; value on hover/focus
│ 1                          31 │
├───────────────────────────────┤
│ Per kategori                  │
│ Makan            Rp980.000    │
│ ████████████████              │  tap = filter table
│ Transport        Rp620.000    │
│ ██████████                    │
├───────────────────────────────┤
│ Transaksi · Makan  (semua)    │
│ Tgl  Keterangan      Nominal  │
│ 3    makan siang    Rp20.000  │
│      Makan  [Ubah ▾]          │  expands: edit form + Hapus
├───────────────────────────────┤
│ Atur kategori                 │
└───────────────────────────────┘
```

- **Total**: sum of the month.
- **Comparison**: `▲ RpX lebih banyak dari <prev month>` / `▼ RpX lebih sedikit dari <prev month>` / `Sama dengan <prev month>`.
- **Average per day**: total ÷ days counted. Days counted = today's day of month for the current month, all days for past months. For future months, shown as `—`.
- **Transaksi**: number of rows in the (filtered) table.
- **Daily bars**: single hue, heights relative to the month's highest day, tooltip `3 Okt: Rp20.000` on hover and keyboard focus.
- **Category bars**: ranked by total, amount shown next to each name; tapping filters the table, tapping the active one clears the filter.
- **Table**: newest date first. Each row's **Ubah** expands a form (amount, description, category with suggestions, date) and a **Hapus** button with a confirmation dialog.
- Edit validation: amount is a whole number > 0; description and category non-empty after trimming; date `YYYY-MM-DD`. Invalid → 400 "Data tidak valid". After saving, go to the month of the (possibly new) date.
- Editing an expense's category does **not** change keywords; only chat tags and the Categories page do.

### 9.3 Categories page (`/categories`)

- Keywords grouped by category, each with a **Hapus** button.
- Form to add a keyword or move it to another category (keyword is stored lowercased and trimmed).
- Changes affect new messages only; existing expenses keep their category.

### 9.4 Look and feel

- Mobile-first, single column, max width 720px, no horizontal scrolling at 375px.
- Follows the phone's light/dark setting.
- Colors from the dataviz reference palette: bars `#2a78d6` (light) / `#3987e5` (dark). Month-over-month increase is shown in red, decrease in green (spending less is good).
- Indonesian UI text. Page titles end with `· SpendChat`; the login page heading is `SpendChat`.

## 10. Defaults chosen during design

These were decided without explicit discussion; change them here before implementation if needed.

| Topic | Default |
|---|---|
| Seed categories and keywords | Section 5 table |
| Command words | Section 7.1 table (Indonesian + English); `kemarin`/`yesterday` |
| Reply language | Always Indonesian, whichever language the command used |
| Tag memory | Tags remember the whole description as a phrase (`kopi susu #jajan` remembers "kopi susu") |
| Undo scope | `hapus` / `undo` removes the latest message's expenses, repeatable |
| Week start | Monday |
| Login link lifetime | 10 minutes, single use |
| Session lifetime | 30 days |
| Lines with only a number | Skipped (no description) |

## 11. Testing

Vitest with `@cloudflare/vitest-pool-workers`: tests run inside the Workers runtime with a local D1; migrations are applied once and tables are reset before each test. The Graph API is mocked by spying on `fetch`.

| Area | Cases |
|---|---|
| parser | every row of sections 7.3 and 7.4; meal-time boundaries 03:59, 04:00, 10:59, 11:00, 14:59, 15:00, 17:59, 18:00; WIB date near midnight UTC; command detection in both languages incl. `hari ini makan 20` and `constructor`; `yesterday` prefix |
| db | save + marker atomically, tag memory, undo grouping, range sums, ordering, edit/delete, keyword CRUD, token single-use and expiry |
| replies | exact texts of section 7.5 |
| bot | multi-line save, tag reuse, `kemarin` excluded from today's total, three summaries, undo, login link, help, non-text |
| webhook | handshake, bad signature, unknown sender, status event, duplicate delivery, re-delivered `hapus`, send failure keeps data |
| auth | session signing/expiry/tampering, GET does not consume token, cookie flags, reused/expired/unknown token, redirects |
| dashboard / categories | totals and comparison, category filter, past-month average, invalid month, edit/validation/delete, keyword add/change/delete |

## 12. Tooling

pnpm; TypeScript strict; Hono; Wrangler; Biome for lint and format; Vitest. `compatibility_date` is kept at or below the workerd version bundled with `@cloudflare/vitest-pool-workers` (currently `2026-08-15`). Typecheck, lint, and tests run after every implementation step.

## 13. Future ideas (not in v1)

Monthly budget per category with warnings in replies; income entries; CSV export; household mode using `sender`; weekly summary sent automatically (needs a message template, since it is outside the 24-hour window).
