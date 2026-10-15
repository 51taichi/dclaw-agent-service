import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export function openDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      accent TEXT NOT NULL DEFAULT '#2a30d8',
      agent_api_url TEXT NOT NULL DEFAULT '',
      agent_api_key TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      webhook_secret TEXT NOT NULL DEFAULT '',
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql}),
      UNIQUE(provider, id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
      external_conversation_id TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'ai' CHECK(mode IN ('ai', 'human')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed')),
      state TEXT NOT NULL DEFAULT 'new',
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT NOT NULL DEFAULT (${nowSql}),
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql}),
      UNIQUE(account_id, external_conversation_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      external_message_id TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
      sender_type TEXT NOT NULL CHECK(sender_type IN ('customer', 'agent', 'human', 'system')),
      message_type TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL DEFAULT '',
      delivery_status TEXT NOT NULL DEFAULT 'received',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      UNIQUE(conversation_id, direction, external_message_id)
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      provider_message_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS channel_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
      external_conversation_id TEXT NOT NULL,
      provider_message_id TEXT NOT NULL UNIQUE,
      message_type TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS processed_events (
      provider TEXT NOT NULL,
      account_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      PRIMARY KEY(provider, account_id, event_id)
    );

    CREATE TABLE IF NOT EXISTS state_machine_configs (
      account_id TEXT PRIMARY KEY REFERENCES channel_accounts(id) ON DELETE CASCADE,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS state_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS tag_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#2a30d8',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      UNIQUE(account_id, name)
    );

    CREATE TABLE IF NOT EXISTS conversation_tags (
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tag_definitions(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'manual',
      evidence_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      PRIMARY KEY(conversation_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS attention_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS handoff_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      from_mode TEXT NOT NULL,
      to_mode TEXT NOT NULL,
      operator TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT,
      conversation_id INTEGER,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_account_recent ON conversations(account_id, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_recent ON messages(conversation_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_status_recent ON attention_alerts(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_outbox_poll ON channel_outbox(account_id, external_conversation_id, id);
  `);
}

function seed(db) {
  const insertAccount = db.prepare(`
    INSERT OR IGNORE INTO channel_accounts (id, provider, name, accent, config_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertAccount.run("website-default", "website", "官网客服", "#2a30d8", JSON.stringify({ delivery: "poll" }));
  insertAccount.run("miniapp-default", "miniapp", "智能名片", "#18a66a", JSON.stringify({ delivery: "poll" }));
  insertAccount.run("fake-demo", "fake", "本地演示", "#ef2625", JSON.stringify({ delivery: "memory" }));

  const defaultMachine = JSON.stringify({
    initialState: "new",
    states: [
      { id: "new", name: "新会话", color: "#6b6472" },
      { id: "engaged", name: "沟通中", color: "#2a30d8" },
      { id: "qualified", name: "已识别意向", color: "#ff5a12" },
      { id: "follow_up", name: "待跟进", color: "#ef2625" },
      { id: "completed", name: "已完成", color: "#126fd4" }
    ]
  });
  const insertMachine = db.prepare("INSERT OR IGNORE INTO state_machine_configs (account_id, config_json) VALUES (?, ?)");
  for (const id of ["website-default", "miniapp-default", "fake-demo"]) insertMachine.run(id, defaultMachine);

  const insertTag = db.prepare("INSERT OR IGNORE INTO tag_definitions (account_id, name, color, description) VALUES (?, ?, ?, ?)");
  for (const id of ["website-default", "miniapp-default", "fake-demo"]) {
    insertTag.run(id, "高意向", "#ef2625", "近期有明确购买或合作意向");
    insertTag.run(id, "待跟进", "#ff5a12", "需要人工后续处理");
    insertTag.run(id, "已成交", "#126fd4", "已经完成目标转化");
  }
}

export function json(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function isoNow() {
  return new Date().toISOString();
}
