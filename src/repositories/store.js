import { json, isoNow } from "../database.js";

export class Store {
  constructor(db) {
    this.db = db;
  }

  listAccounts({ includeSecrets = false } = {}) {
    return this.db.prepare("SELECT * FROM channel_accounts ORDER BY CASE provider WHEN 'website' THEN 1 WHEN 'miniapp' THEN 2 WHEN 'fake' THEN 3 ELSE 4 END, created_at, id").all().map((row) => accountView(row, includeSecrets));
  }

  getAccount(id, { includeSecrets = false } = {}) {
    const row = this.db.prepare("SELECT * FROM channel_accounts WHERE id = ?").get(id);
    return row ? accountView(row, includeSecrets) : null;
  }

  createAccount(input) {
    const id = cleanText(input.id, "", 80);
    const provider = cleanText(input.provider, "", 32);
    const name = cleanText(input.name, "", 120);
    if (!/^[a-z][a-z0-9-]{2,79}$/.test(id) || !/^[a-z][a-z0-9-]{1,31}$/.test(provider) || !name) {
      throw new TypeError("Invalid channel account");
    }
    this.db.prepare(`
      INSERT INTO channel_accounts (id, provider, name, enabled, accent, agent_api_url, agent_api_key, agent_id, webhook_secret, config_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, provider, name, input.enabled === false ? 0 : 1,
      /^#[0-9a-f]{6}$/i.test(input.accent || "") ? input.accent : "#2a30d8",
      cleanText(input.agentApiUrl, "", 1000), cleanText(input.agentApiKey, "", 1000),
      cleanText(input.agentId, "", 200), cleanText(input.webhookSecret, "", 500),
      JSON.stringify(input.config && typeof input.config === "object" ? input.config : { delivery: "poll" })
    );
    const defaultMachine = { initialState: "new", states: [{ id: "new", name: "新会话", color: "#6b6472" }, { id: "engaged", name: "沟通中", color: "#2a30d8" }, { id: "follow_up", name: "待跟进", color: "#ef2625" }, { id: "completed", name: "已完成", color: "#126fd4" }] };
    this.saveStateMachine(id, defaultMachine);
    return this.getAccount(id);
  }

  updateAccount(id, input) {
    const existing = this.getAccount(id, { includeSecrets: true });
    if (!existing) return null;
    const value = {
      name: cleanText(input.name, existing.name, 120),
      enabled: input.enabled === undefined ? existing.enabled : Boolean(input.enabled),
      accent: /^#[0-9a-f]{6}$/i.test(input.accent || "") ? input.accent : existing.accent,
      agentApiUrl: cleanText(input.agentApiUrl, existing.agentApiUrl, 1000),
      agentApiKey: input.agentApiKey === undefined || input.agentApiKey === "••••••••" ? existing.agentApiKey : cleanText(input.agentApiKey, "", 1000),
      agentId: cleanText(input.agentId, existing.agentId, 200),
      webhookSecret: input.webhookSecret === undefined || input.webhookSecret === "••••••••" ? existing.webhookSecret : cleanText(input.webhookSecret, "", 500),
      config: input.config && typeof input.config === "object" ? input.config : existing.config
    };
    this.db.prepare(`
      UPDATE channel_accounts
      SET name = ?, enabled = ?, accent = ?, agent_api_url = ?, agent_api_key = ?, agent_id = ?, webhook_secret = ?, config_json = ?, updated_at = ?
      WHERE id = ?
    `).run(value.name, value.enabled ? 1 : 0, value.accent, value.agentApiUrl, value.agentApiKey, value.agentId, value.webhookSecret, JSON.stringify(value.config), isoNow(), id);
    this.audit(id, null, "configuration", "account.updated", { fields: Object.keys(input).filter((key) => !key.toLowerCase().includes("key") && !key.toLowerCase().includes("secret")) });
    return this.getAccount(id);
  }

  dashboard(accountId) {
    const totals = this.db.prepare(`
      SELECT
        COUNT(*) AS conversations,
        SUM(CASE WHEN mode = 'human' THEN 1 ELSE 0 END) AS human_count,
        SUM(CASE WHEN unread_count > 0 THEN 1 ELSE 0 END) AS unread_count
      FROM conversations WHERE account_id = ?
    `).get(accountId);
    const messagesToday = this.db.prepare(`
      SELECT COUNT(*) AS count FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = ? AND m.created_at >= date('now')
    `).get(accountId)?.count || 0;
    const openAlerts = this.db.prepare(`
      SELECT COUNT(*) AS count FROM attention_alerts a
      JOIN conversations c ON c.id = a.conversation_id
      WHERE c.account_id = ? AND a.status = 'open'
    `).get(accountId)?.count || 0;
    const states = this.db.prepare("SELECT state, COUNT(*) AS count FROM conversations WHERE account_id = ? GROUP BY state ORDER BY count DESC").all(accountId);
    return {
      conversations: Number(totals?.conversations || 0),
      humanCount: Number(totals?.human_count || 0),
      unreadCount: Number(totals?.unread_count || 0),
      messagesToday: Number(messagesToday),
      openAlerts: Number(openAlerts),
      states
    };
  }

  listConversations(accountId, { query = "", state = "", mode = "" } = {}) {
    const clauses = ["c.account_id = ?"];
    const params = [accountId];
    if (query) {
      clauses.push("(c.display_name LIKE ? OR c.external_user_id LIKE ? OR c.external_conversation_id LIKE ?)");
      params.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    if (state) { clauses.push("c.state = ?"); params.push(state); }
    if (mode) { clauses.push("c.mode = ?"); params.push(mode); }
    const rows = this.db.prepare(`
      SELECT c.*,
        (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message,
        (SELECT COUNT(*) FROM attention_alerts WHERE conversation_id = c.id AND status = 'open') AS alert_count
      FROM conversations c WHERE ${clauses.join(" AND ")}
      ORDER BY c.last_message_at DESC LIMIT 300
    `).all(...params);
    const tags = this.db.prepare(`
      SELECT ct.conversation_id, td.id, td.name, td.color
      FROM conversation_tags ct JOIN tag_definitions td ON td.id = ct.tag_id
      JOIN conversations c ON c.id = ct.conversation_id WHERE c.account_id = ?
    `).all(accountId);
    const byConversation = Map.groupBy(tags, (item) => Number(item.conversation_id));
    return rows.map((row) => ({ ...conversationView(row), tags: byConversation.get(Number(row.id)) || [] }));
  }

  getConversation(id) {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    if (!row) return null;
    const tags = this.db.prepare(`SELECT td.id, td.name, td.color, ct.source FROM conversation_tags ct JOIN tag_definitions td ON td.id = ct.tag_id WHERE ct.conversation_id = ?`).all(id);
    return { ...conversationView(row), tags };
  }

  listMessages(conversationId) {
    return this.db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 1000").all(conversationId).map(messageView);
  }

  conversationContext(conversationId, limit = 20) {
    return this.db.prepare(`SELECT id, direction, sender_type, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`).all(conversationId, limit).reverse().map((row) => ({
      id: Number(row.id), direction: row.direction, senderType: row.sender_type, content: row.content, createdAt: row.created_at
    }));
  }

  recordInbound(event) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const inserted = this.db.prepare("INSERT OR IGNORE INTO processed_events (provider, account_id, event_id) VALUES (?, ?, ?)").run(event.provider, event.accountId, event.eventId);
      if (!inserted.changes) {
        this.db.exec("ROLLBACK");
        return { duplicate: true };
      }
      const now = event.occurredAt || isoNow();
      const stateMachine = this.getStateMachine(event.accountId);
      const initialState = String(stateMachine.initialState || "new");
      this.db.prepare(`
        INSERT INTO conversations (account_id, external_conversation_id, external_user_id, display_name, state, unread_count, last_message_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(account_id, external_conversation_id) DO UPDATE SET
          external_user_id = excluded.external_user_id,
          display_name = CASE WHEN excluded.display_name = '' THEN conversations.display_name ELSE excluded.display_name END,
          unread_count = conversations.unread_count + 1,
          last_message_at = excluded.last_message_at,
          updated_at = excluded.updated_at
      `).run(event.accountId, event.externalConversationId, event.externalUserId, event.displayName, initialState, now, now, now);
      const conversation = this.db.prepare("SELECT * FROM conversations WHERE account_id = ? AND external_conversation_id = ?").get(event.accountId, event.externalConversationId);
      const insertedMessage = this.db.prepare(`
        INSERT INTO messages (conversation_id, external_message_id, direction, sender_type, message_type, content, delivery_status, metadata_json, created_at)
        VALUES (?, ?, 'inbound', 'customer', ?, ?, 'received', ?, ?)
      `).run(conversation.id, event.externalMessageId, event.messageType, event.text, JSON.stringify({ attachments: event.attachments, ...event.metadata }), now);
      this.audit(event.accountId, Number(conversation.id), "message", "message.received", { provider: event.provider, messageId: Number(insertedMessage.lastInsertRowid) });
      this.db.exec("COMMIT");
      return {
        duplicate: false,
        conversation: conversationView(conversation),
        message: this.getMessage(Number(insertedMessage.lastInsertRowid))
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getMessage(id) {
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
    return row ? messageView(row) : null;
  }

  createOutbound(conversationId, { content, senderType, messageType = "text", metadata = {} }) {
    const result = this.db.prepare(`
      INSERT INTO messages (conversation_id, direction, sender_type, message_type, content, delivery_status, metadata_json)
      VALUES (?, 'outbound', ?, ?, ?, 'pending', ?)
    `).run(conversationId, senderType, messageType, content, JSON.stringify(metadata));
    const id = Number(result.lastInsertRowid);
    this.db.prepare("UPDATE conversations SET last_message_at = ?, updated_at = ? WHERE id = ?").run(isoNow(), isoNow(), conversationId);
    return this.getMessage(id);
  }

  createDelivery({ messageId, accountId, provider, idempotencyKey }) {
    const result = this.db.prepare(`INSERT INTO deliveries (message_id, account_id, provider, idempotency_key) VALUES (?, ?, ?, ?)`).run(messageId, accountId, provider, idempotencyKey);
    return Number(result.lastInsertRowid);
  }

  finishDelivery(id, { status, providerMessageId = "", error = "" }) {
    const delivery = this.db.prepare("SELECT message_id FROM deliveries WHERE id = ?").get(id);
    this.db.prepare(`UPDATE deliveries SET status = ?, provider_message_id = ?, last_error = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?`).run(status, providerMessageId, error, isoNow(), id);
    if (delivery) this.db.prepare("UPDATE messages SET delivery_status = ?, external_message_id = CASE WHEN ? = '' THEN external_message_id ELSE ? END WHERE id = ?").run(status, providerMessageId, providerMessageId, delivery.message_id);
  }

  publishOutbox({ accountId, externalConversationId, providerMessageId, messageType, text, attachments, metadata }) {
    this.db.prepare(`INSERT INTO channel_outbox (account_id, external_conversation_id, provider_message_id, message_type, content, payload_json) VALUES (?, ?, ?, ?, ?, ?)`).run(accountId, externalConversationId, providerMessageId, messageType, text, JSON.stringify({ attachments, metadata }));
  }

  pollOutbox(accountId, externalConversationId, after = 0) {
    return this.db.prepare(`SELECT id, provider_message_id, message_type, content, payload_json, created_at FROM channel_outbox WHERE account_id = ? AND external_conversation_id = ? AND id > ? ORDER BY id LIMIT 100`).all(accountId, externalConversationId, after).map((row) => ({
      id: Number(row.id), providerMessageId: row.provider_message_id, messageType: row.message_type, content: row.content, ...json(row.payload_json), createdAt: row.created_at
    }));
  }

  acknowledgeDelivery(accountId, providerMessageId, status) {
    const allowed = new Set(["queued", "sent", "delivered", "read", "failed"]);
    if (!allowed.has(status)) throw new TypeError("Invalid delivery status");
    const delivery = this.db.prepare("SELECT d.id, d.message_id FROM deliveries d WHERE d.account_id = ? AND d.provider_message_id = ?").get(accountId, providerMessageId);
    if (!delivery) return false;
    this.db.prepare("UPDATE deliveries SET status = ?, updated_at = ? WHERE id = ?").run(status, isoNow(), delivery.id);
    this.db.prepare("UPDATE messages SET delivery_status = ? WHERE id = ?").run(status, delivery.message_id);
    return true;
  }

  setConversationMode(id, mode, { operator = "console", note = "" } = {}) {
    if (!['ai', 'human'].includes(mode)) throw new TypeError("Invalid conversation mode");
    const current = this.getConversation(id);
    if (!current) return null;
    if (current.mode !== mode) {
      this.db.prepare("UPDATE conversations SET mode = ?, updated_at = ? WHERE id = ?").run(mode, isoNow(), id);
      this.db.prepare("INSERT INTO handoff_events (conversation_id, from_mode, to_mode, operator, note) VALUES (?, ?, ?, ?, ?)").run(id, current.mode, mode, operator, note);
      this.audit(current.accountId, id, "handoff", "conversation.mode_changed", { from: current.mode, to: mode, operator, note });
    }
    return this.getConversation(id);
  }

  setConversationState(id, state, reason = "agent") {
    const conversation = this.getConversation(id);
    if (!conversation || conversation.state === state) return conversation;
    const machine = this.getStateMachine(conversation.accountId);
    if (!machine.states.some((item) => item.id === state)) return conversation;
    this.db.prepare("UPDATE conversations SET state = ?, updated_at = ? WHERE id = ?").run(state, isoNow(), id);
    this.db.prepare("INSERT INTO state_events (conversation_id, from_state, to_state, reason) VALUES (?, ?, ?, ?)").run(id, conversation.state, state, reason);
    this.audit(conversation.accountId, id, "state", "state.changed", { from: conversation.state, to: state, reason });
    return this.getConversation(id);
  }

  markRead(id) {
    this.db.prepare("UPDATE conversations SET unread_count = 0, updated_at = ? WHERE id = ?").run(isoNow(), id);
  }

  getStateMachine(accountId) {
    const row = this.db.prepare("SELECT config_json FROM state_machine_configs WHERE account_id = ?").get(accountId);
    return json(row?.config_json, { initialState: "new", states: [] });
  }

  saveStateMachine(accountId, config) {
    validateStateMachine(config);
    this.db.prepare(`INSERT INTO state_machine_configs (account_id, config_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`).run(accountId, JSON.stringify(config), isoNow());
    this.audit(accountId, null, "configuration", "state_machine.updated", { stateCount: config.states.length });
    return this.getStateMachine(accountId);
  }

  listTags(accountId) {
    return this.db.prepare("SELECT id, name, color, description, created_at FROM tag_definitions WHERE account_id = ? ORDER BY id").all(accountId).map((row) => ({ ...row, id: Number(row.id), createdAt: row.created_at }));
  }

  createTag(accountId, { name, color = "#2a30d8", description = "" }) {
    const cleanName = cleanText(name, "", 60);
    if (!cleanName) throw new TypeError("Tag name is required");
    const result = this.db.prepare("INSERT INTO tag_definitions (account_id, name, color, description) VALUES (?, ?, ?, ?)").run(accountId, cleanName, /^#[0-9a-f]{6}$/i.test(color) ? color : "#2a30d8", cleanText(description, "", 300));
    return this.db.prepare("SELECT id, name, color, description FROM tag_definitions WHERE id = ?").get(result.lastInsertRowid);
  }

  assignTags(conversationId, names, { source = "agent", evidenceMessageId = null } = {}) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return [];
    const available = new Map(this.listTags(conversation.accountId).map((tag) => [tag.name, tag]));
    const insert = this.db.prepare("INSERT OR IGNORE INTO conversation_tags (conversation_id, tag_id, source, evidence_message_id) VALUES (?, ?, ?, ?)");
    for (const name of Array.isArray(names) ? names : []) {
      const tag = available.get(String(name));
      if (tag) insert.run(conversationId, tag.id, source, evidenceMessageId);
    }
    return this.getConversation(conversationId).tags;
  }

  createAlert(conversationId, messageId, { title, detail = "" }) {
    const result = this.db.prepare("INSERT INTO attention_alerts (conversation_id, message_id, title, detail) VALUES (?, ?, ?, ?)").run(conversationId, messageId || null, cleanText(title, "需要人工关注", 160), cleanText(detail, "", 1000));
    const conversation = this.getConversation(conversationId);
    this.audit(conversation?.accountId, conversationId, "attention", "alert.created", { alertId: Number(result.lastInsertRowid), title });
    return Number(result.lastInsertRowid);
  }

  listAlerts(accountId, status = "open") {
    return this.db.prepare(`
      SELECT a.*, c.display_name FROM attention_alerts a JOIN conversations c ON c.id = a.conversation_id
      WHERE c.account_id = ? AND (? = '' OR a.status = ?) ORDER BY a.created_at DESC LIMIT 200
    `).all(accountId, status, status).map((row) => ({ id: Number(row.id), conversationId: Number(row.conversation_id), messageId: row.message_id ? Number(row.message_id) : null, title: row.title, detail: row.detail, status: row.status, displayName: row.display_name, createdAt: row.created_at, resolvedAt: row.resolved_at }));
  }

  resolveAlert(id) {
    this.db.prepare("UPDATE attention_alerts SET status = 'resolved', resolved_at = ? WHERE id = ?").run(isoNow(), id);
  }

  listAudit(accountId, limit = 200) {
    return this.db.prepare("SELECT * FROM audit_logs WHERE account_id = ? ORDER BY id DESC LIMIT ?").all(accountId, limit).map((row) => ({ id: Number(row.id), conversationId: row.conversation_id ? Number(row.conversation_id) : null, category: row.category, action: row.action, detail: json(row.detail_json), createdAt: row.created_at }));
  }

  audit(accountId, conversationId, category, action, detail = {}) {
    this.db.prepare("INSERT INTO audit_logs (account_id, conversation_id, category, action, detail_json) VALUES (?, ?, ?, ?, ?)").run(accountId || null, conversationId || null, category, action, JSON.stringify(detail));
  }
}

function accountView(row, includeSecrets = false) {
  const result = {
    id: row.id,
    provider: row.provider,
    name: row.name,
    enabled: Boolean(row.enabled),
    accent: row.accent,
    agentApiUrl: row.agent_api_url,
    agentApiKeyConfigured: Boolean(row.agent_api_key),
    agentApiKey: includeSecrets ? row.agent_api_key : row.agent_api_key ? "••••••••" : "",
    agentId: row.agent_id,
    webhookSecretConfigured: Boolean(row.webhook_secret),
    webhookSecret: includeSecrets ? row.webhook_secret : row.webhook_secret ? "••••••••" : "",
    config: json(row.config_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  return result;
}

function conversationView(row) {
  return {
    id: Number(row.id), accountId: row.account_id, externalConversationId: row.external_conversation_id,
    externalUserId: row.external_user_id, displayName: row.display_name, mode: row.mode, status: row.status,
    state: row.state, unreadCount: Number(row.unread_count || 0), lastMessage: row.last_message || "",
    alertCount: Number(row.alert_count || 0), lastMessageAt: row.last_message_at, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function messageView(row) {
  return {
    id: Number(row.id), conversationId: Number(row.conversation_id), externalMessageId: row.external_message_id,
    direction: row.direction, senderType: row.sender_type, messageType: row.message_type,
    content: row.content, deliveryStatus: row.delivery_status, metadata: json(row.metadata_json), createdAt: row.created_at
  };
}

function cleanText(value, fallback = "", max = 1000) {
  if (value === undefined || value === null) return fallback;
  return String(value).trim().slice(0, max);
}

function validateStateMachine(config) {
  if (!config || !Array.isArray(config.states) || !config.states.length) throw new TypeError("State machine requires at least one state");
  const ids = new Set();
  for (const state of config.states) {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(state?.id || "") || !String(state?.name || "").trim() || ids.has(state.id)) throw new TypeError("Invalid state machine state");
    ids.add(state.id);
  }
  if (!ids.has(config.initialState)) throw new TypeError("Initial state must exist");
}
