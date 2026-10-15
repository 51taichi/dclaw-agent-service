import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defaultFlowConfig } from "./flow-machine.js";
import { normalizeStoredTagSchema } from "./tags.js";

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
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS flow_sessions (
      conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
      current_node_id TEXT NOT NULL,
      collected_data_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed')),
      entered_at TEXT NOT NULL DEFAULT (${nowSql}),
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS flow_state_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      node_completed INTEGER NOT NULL DEFAULT 0,
      collected_data_patch_json TEXT NOT NULL DEFAULT '{}',
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'agent',
      created_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS tag_schemas (
      account_id TEXT PRIMARY KEY REFERENCES channel_accounts(id) ON DELETE CASCADE,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS conversation_rule_tags (
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL,
      group_name TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      tag_name TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      evidence_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      evidence_text TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'agent',
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql}),
      PRIMARY KEY(conversation_id, group_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS tag_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      evidence_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      evidence_text TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'agent',
      created_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS activation_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK(source_type IN ('flow', 'tag')),
      source_key TEXT NOT NULL,
      message_index INTEGER NOT NULL,
      sequence_no INTEGER NOT NULL,
      content TEXT NOT NULL,
      polish_by_agent INTEGER NOT NULL DEFAULT 1,
      due_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'sent', 'canceled', 'failed')),
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
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
    CREATE INDEX IF NOT EXISTS idx_flow_events_conversation ON flow_state_events(conversation_id, id);
    CREATE INDEX IF NOT EXISTS idx_rule_tags_conversation ON conversation_rule_tags(conversation_id, group_id);
    CREATE INDEX IF NOT EXISTS idx_tag_events_conversation ON tag_events(conversation_id, id);
    CREATE INDEX IF NOT EXISTS idx_activation_tasks_due ON activation_tasks(status, due_at, id);
  `);

  ensureColumn(db, "state_machine_configs", "enabled", "INTEGER NOT NULL DEFAULT 0");
}

function seed(db) {
  const insertAccount = db.prepare(`
    INSERT OR IGNORE INTO channel_accounts (id, provider, name, accent, config_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertAccount.run("website-default", "website", "官网客服", "#2a30d8", JSON.stringify({ delivery: "poll" }));
  insertAccount.run("miniapp-default", "miniapp", "智能名片", "#18a66a", JSON.stringify({ delivery: "poll" }));
  insertAccount.run("fake-demo", "fake", "本地演示", "#ef2625", JSON.stringify({ delivery: "memory" }));

  const insertMachine = db.prepare("INSERT OR IGNORE INTO state_machine_configs (account_id, config_json, enabled) VALUES (?, ?, 0)");
  for (const id of ["website-default", "miniapp-default", "fake-demo"]) {
    insertMachine.run(id, JSON.stringify(defaultFlowConfig(id === "miniapp-default" ? "智能名片" : id === "website-default" ? "官网客服" : "本地演示")));
  }

  const defaultSchema = normalizeStoredTagSchema({
    version: "1.0.0",
    dateTag: { enabled: true, cutoffTime: "00:00" },
    groups: [
      {
        id: "intent_level",
        name: "意向等级",
        enabled: true,
        exclusive: true,
        oneWay: true,
        tags: [
          { id: "potential", name: "潜在客户", condition: "客户表达了初步兴趣", enabled: true },
          { id: "high_intent", name: "高意向", condition: "客户明确希望购买、合作或留下联系方式", enabled: true, voiceAlertEnabled: true }
        ]
      },
      {
        id: "service_attention",
        name: "服务关注",
        enabled: true,
        exclusive: false,
        oneWay: false,
        tags: [
          { id: "needs_follow_up", name: "待跟进", condition: "客户要求稍后联系或当前问题需要后续处理", enabled: true },
          { id: "needs_human", name: "需要人工", condition: "客户明确要求人工服务或出现必须人工处理的情况", enabled: true, voiceAlertEnabled: true, handoffEnabled: true }
        ]
      }
    ]
  });
  const insertSchema = db.prepare("INSERT OR IGNORE INTO tag_schemas (account_id, config_json) VALUES (?, ?)");
  for (const id of ["website-default", "miniapp-default", "fake-demo"]) insertSchema.run(id, JSON.stringify(defaultSchema));

}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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
