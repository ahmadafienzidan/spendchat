CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  amount INTEGER NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  spent_on TEXT NOT NULL,
  sender TEXT NOT NULL,
  wa_message_id TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (wa_message_id, line_no)
);

CREATE INDEX expenses_spent_on ON expenses (spent_on);

CREATE TABLE category_keywords (
  keyword TEXT PRIMARY KEY,
  category TEXT NOT NULL
);

CREATE TABLE login_tokens (
  token TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE processed_messages (
  wa_message_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);
