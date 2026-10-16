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

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      accent TEXT NOT NULL DEFAULT '#2a30d8',
      logo_url TEXT NOT NULL DEFAULT '',
      company_context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      persona_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql}),
      UNIQUE(workspace_id, id)
    );

    CREATE TABLE IF NOT EXISTS workspace_channels (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      webhook_secret TEXT NOT NULL DEFAULT '',
      draft_config_json TEXT NOT NULL DEFAULT '{}',
      published_config_json TEXT NOT NULL DEFAULT '{}',
      published_version INTEGER NOT NULL DEFAULT 0,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql}),
      UNIQUE(workspace_id, id)
    );

    CREATE TABLE IF NOT EXISTS channel_deployments (
      id TEXT PRIMARY KEY,
      workspace_channel_id TEXT NOT NULL REFERENCES workspace_channels(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL UNIQUE REFERENCES channel_accounts(id) ON DELETE CASCADE,
      public_slug TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      draft_config_json TEXT NOT NULL DEFAULT '{}',
      published_config_json TEXT NOT NULL DEFAULT '{}',
      published_version INTEGER NOT NULL DEFAULT 0,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql}),
      UNIQUE(workspace_channel_id, person_id)
    );

    CREATE TABLE IF NOT EXISTS agent_bindings (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('platform', 'workspace', 'person')),
      scope_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      agent_api_url TEXT NOT NULL DEFAULT '',
      agent_api_key TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      concurrency_limit INTEGER NOT NULL DEFAULT 0,
      billing_label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql}),
      UNIQUE(scope_type, scope_id)
    );

    CREATE TABLE IF NOT EXISTS agent_usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      binding_id TEXT,
      account_id TEXT NOT NULL,
      workspace_id TEXT,
      person_id TEXT,
      conversation_id INTEGER,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      request_id TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
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
    CREATE INDEX IF NOT EXISTS idx_people_workspace ON people(workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_workspace_channels_workspace ON workspace_channels(workspace_id, provider);
    CREATE INDEX IF NOT EXISTS idx_channel_deployments_channel ON channel_deployments(workspace_channel_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_agent_usage_scope ON agent_usage_logs(workspace_id, person_id, created_at DESC);
  `);

  ensureColumn(db, "state_machine_configs", "enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "channel_accounts", "workspace_id", "TEXT");
  ensureColumn(db, "channel_accounts", "person_id", "TEXT");
  ensureColumn(db, "channel_accounts", "workspace_channel_id", "TEXT");
  ensureColumn(db, "channel_accounts", "deployment_id", "TEXT");
  ensureColumn(db, "people", "config_account_id", "TEXT");
}

function seed(db) {
  const insertAccount = db.prepare(`
    INSERT OR IGNORE INTO channel_accounts (id, provider, name, accent, config_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertAccount.run("website-default", "website", "官网客服", "#2a30d8", JSON.stringify({ delivery: "poll" }));
  insertAccount.run("miniapp-default", "miniapp", "智能名片", "#18a66a", JSON.stringify({ delivery: "poll" }));
  db.prepare("DELETE FROM channel_accounts WHERE id = 'fake-demo'").run();

  const insertMachine = db.prepare("INSERT OR IGNORE INTO state_machine_configs (account_id, config_json, enabled) VALUES (?, ?, 0)");
  for (const id of ["website-default", "miniapp-default"]) {
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
  for (const id of ["website-default", "miniapp-default"]) insertSchema.run(id, JSON.stringify(defaultSchema));

  db.prepare(`INSERT OR IGNORE INTO workspaces (id, slug, name, accent, company_context_json) VALUES (?, ?, ?, ?, ?)`)
    .run("wuhe", "wuhe", "伍合 AIGC", "#2a30d8", JSON.stringify({ industry: "AIGC 内容服务", description: "伍合配音与 AIGC 服务工作区" }));
  db.prepare(`INSERT OR IGNORE INTO people (id, workspace_id, name, title, persona_json) VALUES (?, ?, ?, ?, ?)`)
    .run("wuhe-assistant", "wuhe", "伍合智能顾问", "AIGC 服务顾问", JSON.stringify({
      personality: "专业、耐心、表达清晰",
      speakingStyle: "先理解客户需求，再给出明确建议",
      responsibilities: "介绍伍合配音与 AIGC 服务，收集客户需求并推进后续沟通",
      systemPrompt: "你是伍合 AIGC 的智能服务顾问，应基于公司资料准确回答，不确定时主动转人工。"
    }));

  const insertChannel = db.prepare(`INSERT OR IGNORE INTO workspace_channels (id, workspace_id, provider, name, draft_config_json) VALUES (?, ?, ?, ?, ?)`);
  insertChannel.run("wuhe-website", "wuhe", "website", "伍合官网客服", JSON.stringify({ themeColor: "#2a30d8", position: "right", launcherLabel: "在线咨询", rosterLayout: "avatars" }));
  insertChannel.run("wuhe-miniapp", "wuhe", "miniapp", "伍合智能名片", JSON.stringify({ themeColor: "#1677ff", assistantName: "伍合助手", leadFormEnabled: true, voiceEnabled: false }));

  const insertDeployment = db.prepare(`INSERT OR IGNORE INTO channel_deployments (id, workspace_channel_id, person_id, account_id, public_slug, sort_order, draft_config_json) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertDeployment.run("wuhe-website-assistant", "wuhe-website", "wuhe-assistant", "website-default", "wuhe-assistant-web", 10, JSON.stringify({ welcomeMessage: "您好，我是伍合智能顾问，有什么可以帮您？", suggestedQuestions: ["了解配音服务", "咨询 AIGC 方案"] }));
  insertDeployment.run("wuhe-miniapp-assistant", "wuhe-miniapp", "wuhe-assistant", "miniapp-default", "wuhe-assistant", 10, JSON.stringify({ coverUrl: "", welcomeMessage: "您好，我是伍合智能顾问，很高兴认识您。", suggestedQuestions: ["你是谁", "怎么合作"], resources: [], leadForm: { enabled: true, fields: ["name", "contact"] } }));

  db.prepare(`UPDATE channel_accounts SET workspace_id = 'wuhe', person_id = 'wuhe-assistant', workspace_channel_id = 'wuhe-website', deployment_id = 'wuhe-website-assistant' WHERE id = 'website-default' AND (workspace_id IS NULL OR workspace_id = '')`).run();
  db.prepare(`UPDATE channel_accounts SET workspace_id = 'wuhe', person_id = 'wuhe-assistant', workspace_channel_id = 'wuhe-miniapp', deployment_id = 'wuhe-miniapp-assistant' WHERE id = 'miniapp-default' AND (workspace_id IS NULL OR workspace_id = '')`).run();
  db.prepare(`UPDATE workspace_channels SET webhook_secret = COALESCE(NULLIF((SELECT webhook_secret FROM channel_accounts WHERE id = 'website-default'), ''), webhook_secret) WHERE id = 'wuhe-website' AND webhook_secret = ''`).run();
  db.prepare(`UPDATE workspace_channels SET webhook_secret = COALESCE(NULLIF((SELECT webhook_secret FROM channel_accounts WHERE id = 'miniapp-default'), ''), webhook_secret) WHERE id = 'wuhe-miniapp' AND webhook_secret = ''`).run();
  db.prepare(`UPDATE people SET config_account_id = 'miniapp-default' WHERE id = 'wuhe-assistant' AND (config_account_id IS NULL OR config_account_id = '')`).run();

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
