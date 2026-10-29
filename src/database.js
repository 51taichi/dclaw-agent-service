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
  migrateDingmaiWorkspace(db);
  seed(db);
  migrateAgentCatalog(db);
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
      profile_json TEXT NOT NULL DEFAULT '{}',
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
      assistant_account_id TEXT,
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

    CREATE TABLE IF NOT EXISTS wechat_visitors (
      openid TEXT PRIMARY KEY,
      unionid TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS workspace_miniapps (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'dedicated' CHECK(mode IN ('shared', 'dedicated')),
      name TEXT NOT NULL DEFAULT '',
      app_id TEXT NOT NULL,
      encrypted_app_secret TEXT NOT NULL,
      original_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'configured' CHECK(status IN ('configured', 'verified', 'error')),
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql}),
      UNIQUE(app_id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS workspace_wechat_visitors (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      app_id TEXT NOT NULL,
      openid TEXT NOT NULL,
      unionid TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql}),
      PRIMARY KEY(workspace_id, app_id, openid)
    );

    CREATE TABLE IF NOT EXISTS agent_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      agent_api_url TEXT NOT NULL DEFAULT '',
      agent_api_key TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      concurrency_limit INTEGER NOT NULL DEFAULT 0,
      billing_label TEXT NOT NULL DEFAULT '',
      default_for_person INTEGER NOT NULL DEFAULT 0,
      default_for_assistant INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS agent_bindings (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('platform', 'workspace', 'person', 'assistant')),
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
    CREATE INDEX IF NOT EXISTS idx_agent_configs_defaults ON agent_configs(default_for_person, default_for_assistant);
    CREATE INDEX IF NOT EXISTS idx_workspace_wechat_visitors_openid ON workspace_wechat_visitors(app_id, openid);
  `);

  ensureColumn(db, "state_machine_configs", "enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "channel_accounts", "workspace_id", "TEXT");
  ensureColumn(db, "channel_accounts", "person_id", "TEXT");
  ensureColumn(db, "channel_accounts", "workspace_channel_id", "TEXT");
  ensureColumn(db, "channel_accounts", "deployment_id", "TEXT");
  ensureColumn(db, "people", "config_account_id", "TEXT");
  ensureColumn(db, "people", "profile_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "people", "agent_config_id", "TEXT");
  ensureColumn(db, "workspace_channels", "assistant_account_id", "TEXT");
  ensureColumn(db, "workspace_channels", "assistant_agent_config_id", "TEXT");
  ensureAssistantBindingScope(db);
}

function migrateDingmaiWorkspace(db) {
  const legacy = db.prepare("SELECT id FROM workspaces WHERE id = ?").get("wuhe");
  const current = db.prepare("SELECT id FROM workspaces WHERE id = ?").get("dingmai");
  if (legacy && current) throw new Error("无法迁移顶脉工作区：wuhe 与 dingmai 同时存在");
  if (!legacy) {
    if (current) db.prepare("UPDATE workspaces SET slug = ? WHERE id = ?").run("dingmai", "dingmai");
    return;
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO workspaces (id, slug, name, enabled, accent, logo_url, company_context_json, created_at, updated_at)
      SELECT ?, ?, name, enabled, accent, logo_url, company_context_json, created_at, updated_at FROM workspaces WHERE id = ?`)
      .run("dingmai", "dingmai", "wuhe");
    for (const table of ["people", "workspace_channels", "channel_accounts", "agent_usage_logs", "workspace_miniapps", "workspace_wechat_visitors"]) {
      db.prepare(`UPDATE ${table} SET workspace_id = ? WHERE workspace_id = ?`).run("dingmai", "wuhe");
    }
    db.prepare("UPDATE agent_bindings SET scope_id = ? WHERE scope_type = ? AND scope_id = ?").run("dingmai", "workspace", "wuhe");
    db.prepare("DELETE FROM workspaces WHERE id = ?").run("wuhe");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function seed(db) {
  const defaultMiniappAssistantConfig = {
    assistantName: "D仔",
    assistantNameColor: "#29466f",
    assistantBrandText: "DClaw",
    assistantAvatarUrl: "/console/assets/ddeer.png",
    assistantMascotImageUrl: "/console/assets/ddeer-transparent.png",
    assistantSceneVideoUrl: "/console/assets/ddeer-office-greeting-rig-v3.mp4",
    assistantScenePosterUrl: "/console/assets/ddeer-office-greeting-rig-poster-v3.jpg",
    assistantSceneImageUrl: "/console/assets/ddeer-transparent.png",
    assistantGreeting: "你好，我是D仔，很高兴为你服务",
    assistantPrompt: "你可以这样对我说：",
    assistantTopics: ["集团业务介绍", "课程与服务", "合作咨询", "联系我们"],
    assistantPrimaryTitle: "D仔小助手",
    assistantPrimaryItems: ["了解集团服务", "查看课程体系", "领取合作资料"],
    assistantRecommendedTitle: "专题推荐",
    assistantRecommendedItems: ["热门方案推荐", "企业合作咨询", "预约专属服务"],
    assistantVoiceLabel: "按住 说话",
    assistantVoiceHint: "回答由 AI 生成，内容仅供参考",
    leadFormEnabled: true,
    voiceEnabled: true
  };
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
    .run("dingmai", "dingmai", "顶脉教育集团", "#2a30d8", JSON.stringify({ industry: "教育服务", description: "顶脉教育集团智能服务工作区" }));
  db.prepare(`INSERT OR IGNORE INTO people (id, workspace_id, name, title, avatar_url, persona_json) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("wuhe-assistant", "dingmai", "向小顶", "总裁", "/console/assets/bot-avatar.png", JSON.stringify({
      personality: "专业、耐心、表达清晰",
      speakingStyle: "先理解客户需求，再给出明确建议",
      responsibilities: "介绍顶脉教育集团及相关服务，收集客户需求并推进后续沟通",
      systemPrompt: "你是顶脉教育集团总裁向小顶，应基于公司资料准确回答，不确定时主动转人工。"
    }));

  const insertChannel = db.prepare(`INSERT OR IGNORE INTO workspace_channels (id, workspace_id, provider, name, draft_config_json) VALUES (?, ?, ?, ?, ?)`);
  insertChannel.run("wuhe-website", "dingmai", "website", "伍合官网客服", JSON.stringify({ position: "right", mascotImageUrl: "/console/assets/ddeer.png", launcherLabel: "在线咨询", rosterTitle: "选择成员" }));
  insertChannel.run("wuhe-miniapp", "dingmai", "miniapp", "伍合智能名片", JSON.stringify(defaultMiniappAssistantConfig));
  const websiteChannelConfig = db.prepare(`SELECT draft_config_json, published_config_json FROM workspace_channels WHERE id = 'wuhe-website'`).get();
  const legacyRosterTitle = `选择专属\u987e\u95ee`;
  const websiteDraftConfig = json(websiteChannelConfig?.draft_config_json);
  const websitePublishedConfig = json(websiteChannelConfig?.published_config_json);
  if (websiteDraftConfig.rosterTitle === legacyRosterTitle) db.prepare(`UPDATE workspace_channels SET draft_config_json = ? WHERE id = 'wuhe-website'`).run(JSON.stringify({ ...websiteDraftConfig, rosterTitle: "选择成员" }));
  if (websitePublishedConfig.rosterTitle === legacyRosterTitle) db.prepare(`UPDATE workspace_channels SET published_config_json = ? WHERE id = 'wuhe-website'`).run(JSON.stringify({ ...websitePublishedConfig, rosterTitle: "选择成员" }));

  const insertDeployment = db.prepare(`INSERT OR IGNORE INTO channel_deployments (id, workspace_channel_id, person_id, account_id, public_slug, sort_order, draft_config_json) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertDeployment.run("wuhe-website-assistant", "wuhe-website", "wuhe-assistant", "website-default", "wuhe-assistant-web", 10, JSON.stringify({ welcomeMessage: "您好，我是向小顶，有什么可以帮您？", suggestedQuestions: ["了解集团服务", "咨询合作方案"] }));
  insertDeployment.run("wuhe-miniapp-assistant", "wuhe-miniapp", "wuhe-assistant", "miniapp-default", "wuhe-assistant", 10, JSON.stringify({ coverUrl: "/console/assets/moosee-work-serious-scene.png", companyName: "顶脉教育集团", phone: "400-0731-177", wechat: "dingmai-ai", email: "service@dingmai.example", website: "https://www.dingmai.example", address: "杭州市滨江区江南大道 88 号", qrCodeUrl: "/console/assets/contact-qr-demo.png", welcomeMessage: "您好，我是向小顶，很高兴认识您。", suggestedQuestions: ["你是谁", "怎么合作"], resources: [], leadForm: { enabled: true, fields: ["name", "contact"] } }));

  const legacyQrCodeUrl = "/console/assets/contact-qr-demo.svg";
  const pngQrCodeUrl = "/console/assets/contact-qr-demo.png";
  db.prepare(`UPDATE people SET profile_json = REPLACE(profile_json, ?, ?) WHERE profile_json LIKE ?`).run(legacyQrCodeUrl, pngQrCodeUrl, `%${legacyQrCodeUrl}%`);
  db.prepare(`UPDATE channel_deployments SET draft_config_json = REPLACE(draft_config_json, ?, ?), published_config_json = REPLACE(published_config_json, ?, ?) WHERE draft_config_json LIKE ? OR published_config_json LIKE ?`)
    .run(legacyQrCodeUrl, pngQrCodeUrl, legacyQrCodeUrl, pngQrCodeUrl, `%${legacyQrCodeUrl}%`, `%${legacyQrCodeUrl}%`);

  db.prepare(`UPDATE workspaces SET name = '顶脉教育集团', company_context_json = ? WHERE id = 'dingmai' AND name = '伍合 AIGC'`)
    .run(JSON.stringify({ industry: "教育服务", description: "顶脉教育集团智能服务工作区" }));
  db.prepare(`UPDATE people SET name = '向小顶', title = '总裁', persona_json = ? WHERE id = 'wuhe-assistant' AND name = '伍合智能\u987e\u95ee' AND title = 'AIGC 服务\u987e\u95ee'`)
    .run(JSON.stringify({ personality: "专业、耐心、表达清晰", speakingStyle: "先理解客户需求，再给出明确建议", responsibilities: "介绍顶脉教育集团及相关服务，收集客户需求并推进后续沟通", systemPrompt: "你是顶脉教育集团总裁向小顶，应基于公司资料准确回答，不确定时主动转人工。" }));
  db.prepare(`UPDATE people SET avatar_url = '/console/assets/bot-avatar.png' WHERE id = 'wuhe-assistant' AND name = '向小顶' AND avatar_url = ''`).run();
  db.prepare(`UPDATE people SET title = '商务合作负责人' WHERE id = 'wuhe-sales' AND title = '商务合作\u987e\u95ee'`).run();
  const miniappConfigRow = db.prepare(`SELECT draft_config_json, published_config_json FROM workspace_channels WHERE id = 'wuhe-miniapp'`).get();
  const mergeMiniappConfig = (stored) => {
    const config = json(stored);
    const assistantSceneVideoUrl = [
      "/console/assets/ddeer-assistant-loop.mp4",
      "/console/assets/ddeer-office-greeting-loop-v1.mp4",
      "/console/assets/ddeer-office-greeting-rig-v2.mp4"
    ].includes(config.assistantSceneVideoUrl)
      ? defaultMiniappAssistantConfig.assistantSceneVideoUrl
      : config.assistantSceneVideoUrl;
    return {
      ...defaultMiniappAssistantConfig,
      ...config,
      assistantName: config.assistantName || defaultMiniappAssistantConfig.assistantName,
      assistantSceneVideoUrl: Object.hasOwn(config, "assistantSceneVideoUrl") ? assistantSceneVideoUrl : defaultMiniappAssistantConfig.assistantSceneVideoUrl
    };
  };
  const mergedMiniappDraft = mergeMiniappConfig(miniappConfigRow?.draft_config_json);
  const mergedMiniappPublished = mergeMiniappConfig(miniappConfigRow?.published_config_json);
  db.prepare(`UPDATE workspace_channels SET draft_config_json = ?, published_config_json = ? WHERE id = 'wuhe-miniapp'`)
    .run(JSON.stringify(mergedMiniappDraft), JSON.stringify(mergedMiniappPublished));
  const miniappDeploymentRow = db.prepare(`SELECT draft_config_json FROM channel_deployments WHERE id = 'wuhe-miniapp-assistant'`).get();
  const miniappDeploymentConfig = json(miniappDeploymentRow?.draft_config_json);
  if (miniappDeploymentConfig.companyName === "伍合 AIGC" || miniappDeploymentConfig.welcomeMessage?.includes("伍合智能\u987e\u95ee")) {
    db.prepare(`UPDATE channel_deployments SET draft_config_json = ? WHERE id = 'wuhe-miniapp-assistant'`).run(JSON.stringify({ ...miniappDeploymentConfig, companyName: miniappDeploymentConfig.companyName === "伍合 AIGC" ? "顶脉教育集团" : miniappDeploymentConfig.companyName, welcomeMessage: miniappDeploymentConfig.welcomeMessage?.replace("伍合智能\u987e\u95ee", "向小顶") }));
  }

  const personProfileRow = db.prepare(`SELECT profile_json FROM people WHERE id = 'wuhe-assistant'`).get();
  if (!Object.keys(json(personProfileRow?.profile_json)).length && Object.keys(miniappDeploymentConfig).length) {
    db.prepare(`UPDATE people SET profile_json = ? WHERE id = 'wuhe-assistant'`).run(JSON.stringify(miniappDeploymentConfig));
  }

  db.prepare(`UPDATE channel_accounts SET workspace_id = 'dingmai', person_id = 'wuhe-assistant', workspace_channel_id = 'wuhe-website', deployment_id = 'wuhe-website-assistant' WHERE id = 'website-default' AND (workspace_id IS NULL OR workspace_id = '')`).run();
  db.prepare(`UPDATE channel_accounts SET workspace_id = 'dingmai', person_id = 'wuhe-assistant', workspace_channel_id = 'wuhe-miniapp', deployment_id = 'wuhe-miniapp-assistant' WHERE id = 'miniapp-default' AND (workspace_id IS NULL OR workspace_id = '')`).run();
  db.prepare(`UPDATE workspace_channels SET webhook_secret = COALESCE(NULLIF((SELECT webhook_secret FROM channel_accounts WHERE id = 'website-default'), ''), webhook_secret) WHERE id = 'wuhe-website' AND webhook_secret = ''`).run();
  db.prepare(`UPDATE workspace_channels SET webhook_secret = COALESCE(NULLIF((SELECT webhook_secret FROM channel_accounts WHERE id = 'miniapp-default'), ''), webhook_secret) WHERE id = 'wuhe-miniapp' AND webhook_secret = ''`).run();
  db.prepare(`UPDATE people SET config_account_id = 'miniapp-default' WHERE id = 'wuhe-assistant' AND (config_account_id IS NULL OR config_account_id = '')`).run();

  ensureAssistantAccount(db, {
    channelId: "wuhe-website",
    accountId: "wuhe-website-company-assistant",
    provider: "website",
    name: "伍合官网公司助手"
  });
  ensureAssistantAccount(db, {
    channelId: "wuhe-miniapp",
    accountId: "wuhe-miniapp-company-assistant",
    provider: "miniapp",
    name: "伍合名片公司助手"
  });

}

function ensureAssistantBindingScope(db) {
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_bindings'").get()?.sql || "";
  if (definition.includes("'assistant'")) return;
  db.exec(`
    ALTER TABLE agent_bindings RENAME TO agent_bindings_legacy;
    CREATE TABLE agent_bindings (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('platform', 'workspace', 'person', 'assistant')),
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
    INSERT INTO agent_bindings SELECT * FROM agent_bindings_legacy;
    DROP TABLE agent_bindings_legacy;
  `);
}

function ensureAssistantAccount(db, { channelId, accountId, provider, name }) {
  const channel = db.prepare("SELECT workspace_id, webhook_secret FROM workspace_channels WHERE id = ?").get(channelId);
  if (!channel) return;
  db.prepare(`INSERT OR IGNORE INTO channel_accounts (id, provider, name, accent, webhook_secret, config_json, workspace_id, workspace_channel_id) VALUES (?, ?, ?, '#2a30d8', ?, ?, ?, ?)`)
    .run(accountId, provider, name, channel.webhook_secret || "", JSON.stringify({ delivery: "poll", surface: "company-assistant" }), channel.workspace_id, channelId);
  db.prepare("UPDATE workspace_channels SET assistant_account_id = ? WHERE id = ? AND (assistant_account_id IS NULL OR assistant_account_id = '')").run(accountId, channelId);
  db.prepare("INSERT OR IGNORE INTO state_machine_configs (account_id, config_json, enabled) VALUES (?, ?, 0)").run(accountId, JSON.stringify(defaultFlowConfig(name)));
  db.prepare("INSERT OR IGNORE INTO tag_schemas (account_id, config_json) VALUES (?, ?)").run(accountId, JSON.stringify(normalizeStoredTagSchema({ dateTag: { enabled: true, cutoffTime: "00:00" }, groups: [] })));
}

function migrateAgentCatalog(db) {
  const configCount = Number(db.prepare("SELECT COUNT(*) AS count FROM agent_configs").get()?.count || 0);
  if (!configCount) {
    const platform = db.prepare("SELECT * FROM agent_bindings WHERE scope_type = 'platform' AND scope_id = 'default'").get();
    db.prepare(`INSERT INTO agent_configs (id, name, agent_api_url, agent_api_key, agent_id, concurrency_limit, billing_label, default_for_person, default_for_assistant)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`)
      .run("platform-default", platform?.name || "平台默认 Agent", platform?.agent_api_url || "", platform?.agent_api_key || "", platform?.agent_id || "", Number(platform?.concurrency_limit || 0), platform?.billing_label || "");
  }

  const defaultAgent = db.prepare("SELECT id FROM agent_configs WHERE default_for_person = 1 ORDER BY created_at, id LIMIT 1").get()
    || db.prepare("SELECT id FROM agent_configs WHERE default_for_assistant = 1 ORDER BY created_at, id LIMIT 1").get()
    || db.prepare("SELECT id FROM agent_configs ORDER BY created_at, id LIMIT 1").get();
  if (defaultAgent) db.prepare("UPDATE agent_configs SET default_for_person = CASE WHEN id = ? THEN 1 ELSE 0 END, default_for_assistant = CASE WHEN id = ? THEN 1 ELSE 0 END").run(defaultAgent.id, defaultAgent.id);
  db.prepare("UPDATE agent_configs SET concurrency_limit = 0, billing_label = '' WHERE concurrency_limit <> 0 OR billing_label <> ''").run();

  const legacyBindings = db.prepare("SELECT * FROM agent_bindings WHERE scope_type IN ('person', 'assistant') AND agent_api_url <> '' AND agent_api_key <> ''").all();
  for (const binding of legacyBindings) {
    const configId = `legacy-${binding.id}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 80).replace(/-+$/g, "");
    db.prepare(`INSERT OR IGNORE INTO agent_configs (id, name, agent_api_url, agent_api_key, agent_id, concurrency_limit, billing_label)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(configId, binding.name || "迁移 Agent", binding.agent_api_url, binding.agent_api_key, binding.agent_id || "", Number(binding.concurrency_limit || 0), binding.billing_label || "");
    if (binding.scope_type === "person") db.prepare("UPDATE people SET agent_config_id = COALESCE(agent_config_id, ?) WHERE id = ?").run(configId, binding.scope_id);
    if (binding.scope_type === "assistant") db.prepare("UPDATE workspace_channels SET assistant_agent_config_id = COALESCE(assistant_agent_config_id, ?) WHERE id = ?").run(configId, binding.scope_id);
  }
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
