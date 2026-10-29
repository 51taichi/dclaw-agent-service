import { json, isoNow } from "../database.js";
import { defaultFlowConfig, normalizeFlowConfig } from "../flow-machine.js";
import { adjudicateTagDecision, dateTagIdFor, normalizeStoredTagSchema } from "../tags.js";

export class Store {
  constructor(db) {
    this.db = db;
  }

  listAccounts({ includeSecrets = false, workspaceId = "" } = {}) {
    const where = workspaceId ? "WHERE workspace_id = ?" : "";
    const rows = this.db.prepare(`SELECT * FROM channel_accounts ${where} ORDER BY CASE provider WHEN 'website' THEN 1 WHEN 'miniapp' THEN 2 ELSE 3 END, created_at, id`).all(...(workspaceId ? [workspaceId] : []));
    return rows.map((row) => accountView(row, includeSecrets, this.db));
  }

  getAccount(id, { includeSecrets = false } = {}) {
    const row = this.db.prepare("SELECT * FROM channel_accounts WHERE id = ?").get(id);
    return row ? accountView(row, includeSecrets, this.db) : null;
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
    this.saveFlowMachine(id, { enabled: false, config: defaultFlowConfig(name) });
    this.saveTagSchema(id, { dateTag: { enabled: true, cutoffTime: "00:00" }, groups: [] });
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

  listWorkspaces() {
    return this.db.prepare(`
      SELECT w.*,
        (SELECT COUNT(*) FROM people p WHERE p.workspace_id = w.id) AS person_count,
        (SELECT COUNT(*) FROM workspace_channels c WHERE c.workspace_id = w.id) AS channel_count,
        (SELECT status FROM workspace_miniapps m WHERE m.workspace_id = w.id) AS miniapp_status
      FROM workspaces w ORDER BY w.created_at, w.id
    `).all().map(workspaceView);
  }

  getWorkspace(id) {
    const row = this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id);
    return row ? workspaceView(row) : null;
  }

  createWorkspace(input) {
    const id = identifier(input.id || input.slug);
    const slug = identifier(input.slug || input.id);
    const name = requiredText(input.name, "Workspace name", 120);
    this.db.prepare(`INSERT INTO workspaces (id, slug, name, enabled, accent, logo_url, company_context_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, slug, name, input.enabled === false ? 0 : 1, color(input.accent), cleanText(input.logoUrl, "", 2000), JSON.stringify(objectValue(input.companyContext)));
    return this.getWorkspace(id);
  }

  updateWorkspace(id, input) {
    const existing = this.getWorkspace(id);
    if (!existing) return null;
    const value = {
      slug: input.slug === undefined ? existing.slug : identifier(input.slug),
      name: cleanText(input.name, existing.name, 120) || existing.name,
      enabled: input.enabled === undefined ? existing.enabled : Boolean(input.enabled),
      accent: input.accent === undefined ? existing.accent : color(input.accent),
      logoUrl: cleanText(input.logoUrl, existing.logoUrl, 2000),
      companyContext: input.companyContext === undefined ? existing.companyContext : objectValue(input.companyContext)
    };
    this.db.prepare(`UPDATE workspaces SET slug = ?, name = ?, enabled = ?, accent = ?, logo_url = ?, company_context_json = ?, updated_at = ? WHERE id = ?`)
      .run(value.slug, value.name, value.enabled ? 1 : 0, value.accent, value.logoUrl, JSON.stringify(value.companyContext), isoNow(), id);
    return this.getWorkspace(id);
  }

  getWorkspaceMiniapp(workspaceId, { includeSecrets = false } = {}) {
    const row = this.db.prepare("SELECT * FROM workspace_miniapps WHERE workspace_id = ?").get(workspaceId);
    return row ? workspaceMiniappView(row, includeSecrets) : null;
  }

  saveWorkspaceMiniapp(workspaceId, input) {
    if (!this.getWorkspace(workspaceId)) return null;
    const appId = requiredText(input.appId, "小程序 AppID", 80);
    if (!/^wx[A-Za-z0-9_-]{8,40}$/.test(appId)) throw new TypeError("小程序 AppID 格式不正确");
    const mode = ["shared", "dedicated"].includes(input.mode) ? input.mode : "dedicated";
    const status = ["configured", "verified", "error"].includes(input.status) ? input.status : "configured";
    const encryptedAppSecret = requiredText(input.encryptedAppSecret, "Encrypted AppSecret", 4000);
    this.db.prepare(`INSERT INTO workspace_miniapps (workspace_id, mode, name, app_id, encrypted_app_secret, original_id, status, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET mode = excluded.mode, name = excluded.name, app_id = excluded.app_id,
        encrypted_app_secret = excluded.encrypted_app_secret, original_id = excluded.original_id, status = excluded.status,
        verified_at = excluded.verified_at, updated_at = ?`)
      .run(workspaceId, mode, cleanText(input.name, "", 120), appId, encryptedAppSecret, cleanText(input.originalId, "", 120), status, input.verifiedAt || null, isoNow());
    return this.getWorkspaceMiniapp(workspaceId);
  }

  markWorkspaceMiniappVerified(workspaceId) {
    const timestamp = isoNow();
    const result = this.db.prepare("UPDATE workspace_miniapps SET status = 'verified', verified_at = ?, updated_at = ? WHERE workspace_id = ?").run(timestamp, timestamp, workspaceId);
    return result.changes ? this.getWorkspaceMiniapp(workspaceId) : null;
  }

  resolveMiniappWorkspace({ publicSlug = "", deploymentId = "" } = {}) {
    const field = deploymentId ? "d.id" : "d.public_slug";
    const value = deploymentId || publicSlug;
    if (!value) return null;
    const row = this.db.prepare(`SELECT c.workspace_id, d.id AS deployment_id, d.public_slug
      FROM channel_deployments d JOIN workspace_channels c ON c.id = d.workspace_channel_id
      WHERE ${field} = ? AND c.provider = 'miniapp' AND c.enabled = 1 AND d.enabled = 1`).get(value);
    return row ? { workspaceId: row.workspace_id, deploymentId: row.deployment_id, publicSlug: row.public_slug } : null;
  }

  getWechatVisitor(workspaceId, appId, openid) {
    const row = this.db.prepare("SELECT * FROM workspace_wechat_visitors WHERE workspace_id = ? AND app_id = ? AND openid = ?")
      .get(String(workspaceId || ""), String(appId || ""), String(openid || ""));
    return row ? wechatVisitorView(row) : null;
  }

  ensureWechatVisitor(workspaceId, appId, openid, unionid = "") {
    const normalizedWorkspaceId = requiredText(workspaceId, "Workspace ID", 80);
    const normalizedAppId = requiredText(appId, "WeChat AppID", 80);
    const normalizedOpenid = requiredText(openid, "WeChat openid", 160);
    this.db.prepare(`INSERT INTO workspace_wechat_visitors (workspace_id, app_id, openid, unionid) VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id, app_id, openid) DO UPDATE SET unionid = CASE WHEN excluded.unionid <> '' THEN excluded.unionid ELSE workspace_wechat_visitors.unionid END, updated_at = ?`)
      .run(normalizedWorkspaceId, normalizedAppId, normalizedOpenid, cleanText(unionid, "", 160), isoNow());
    return this.getWechatVisitor(normalizedWorkspaceId, normalizedAppId, normalizedOpenid);
  }

  saveWechatVisitorProfile(workspaceId, appId, openid, input) {
    const existing = this.ensureWechatVisitor(workspaceId, appId, openid);
    const nickname = requiredText(input?.nickName, "微信昵称", 32);
    const avatarUrl = cleanText(input?.avatarUrl, existing.avatarUrl, 2000);
    this.db.prepare("UPDATE workspace_wechat_visitors SET nickname = ?, avatar_url = ?, updated_at = ? WHERE workspace_id = ? AND app_id = ? AND openid = ?")
      .run(nickname, avatarUrl, isoNow(), String(workspaceId), String(appId), String(openid));
    return this.getWechatVisitor(workspaceId, appId, openid);
  }

  listPeople(workspaceId) {
    return this.db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM channel_deployments d WHERE d.person_id = p.id) AS deployment_count
      FROM people p WHERE p.workspace_id = ? ORDER BY p.created_at, p.id
    `).all(workspaceId).map(personView);
  }

  getPerson(id) {
    const row = this.db.prepare("SELECT * FROM people WHERE id = ?").get(id);
    return row ? personView(row) : null;
  }

  createPerson(workspaceId, input) {
    if (!this.getWorkspace(workspaceId)) throw new TypeError("Workspace not found");
    const id = identifier(input.id);
    const agentConfigId = this.agentConfigReference(input.agentConfigId);
    this.db.prepare(`INSERT INTO people (id, workspace_id, name, title, avatar_url, enabled, persona_json, profile_json, agent_config_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, workspaceId, requiredText(input.name, "Person name", 120), cleanText(input.title, "", 160), cleanText(input.avatarUrl, "", 2000), input.enabled === false ? 0 : 1, JSON.stringify(objectValue(input.persona)), JSON.stringify(objectValue(input.profile)), agentConfigId);
    return this.getPerson(id);
  }

  updatePerson(id, input) {
    const existing = this.getPerson(id);
    if (!existing) return null;
    const agentConfigId = input.agentConfigId === undefined ? existing.agentConfigId : this.agentConfigReference(input.agentConfigId);
    this.db.prepare(`UPDATE people SET name = ?, title = ?, avatar_url = ?, enabled = ?, persona_json = ?, profile_json = ?, agent_config_id = ?, updated_at = ? WHERE id = ?`)
      .run(cleanText(input.name, existing.name, 120) || existing.name, cleanText(input.title, existing.title, 160), cleanText(input.avatarUrl, existing.avatarUrl, 2000), input.enabled === undefined ? Number(existing.enabled) : (input.enabled ? 1 : 0), JSON.stringify(input.persona === undefined ? existing.persona : objectValue(input.persona)), JSON.stringify(input.profile === undefined ? existing.profile : objectValue(input.profile)), agentConfigId, isoNow(), id);
    return this.getPerson(id);
  }

  listWorkspaceChannels(workspaceId) {
    return this.db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM channel_deployments d WHERE d.workspace_channel_id = c.id) AS deployment_count
      FROM workspace_channels c WHERE c.workspace_id = ? ORDER BY CASE c.provider WHEN 'website' THEN 1 WHEN 'miniapp' THEN 2 ELSE 3 END, c.created_at
    `).all(workspaceId).map(channelView);
  }

  getWorkspaceChannel(id, { includeSecrets = false } = {}) {
    const row = this.db.prepare("SELECT * FROM workspace_channels WHERE id = ?").get(id);
    return row ? channelView(row, includeSecrets) : null;
  }

  createWorkspaceChannel(workspaceId, input) {
    if (!this.getWorkspace(workspaceId)) throw new TypeError("Workspace not found");
    const id = identifier(input.id);
    const provider = cleanText(input.provider, "", 32);
    if (!["website", "miniapp"].includes(provider)) throw new TypeError("Unsupported channel provider");
    const name = requiredText(input.name, "Channel name", 120);
    const assistantAccountId = `${id}-company-assistant`;
    const secret = cleanText(input.webhookSecret, "", 500);
    const assistantAgentConfigId = this.agentConfigReference(input.assistantAgentConfigId);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`INSERT INTO channel_accounts (id, provider, name, enabled, accent, webhook_secret, config_json, workspace_id, workspace_channel_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(assistantAccountId, provider, `${name} · 公司助手`, input.enabled === false ? 0 : 1, this.getWorkspace(workspaceId).accent, secret, JSON.stringify({ delivery: "poll", surface: "company-assistant" }), workspaceId, id);
      this.db.prepare(`INSERT INTO workspace_channels (id, workspace_id, provider, name, enabled, webhook_secret, assistant_account_id, assistant_agent_config_id, draft_config_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, workspaceId, provider, name, input.enabled === false ? 0 : 1, secret, assistantAccountId, assistantAgentConfigId, JSON.stringify(objectValue(input.config)));
      this.db.prepare("INSERT INTO state_machine_configs (account_id, config_json, enabled) VALUES (?, ?, 0)").run(assistantAccountId, JSON.stringify(defaultFlowConfig(`${name}公司助手`)));
      this.db.prepare("INSERT INTO tag_schemas (account_id, config_json) VALUES (?, ?)").run(assistantAccountId, JSON.stringify(normalizeStoredTagSchema({ dateTag: { enabled: true, cutoffTime: "00:00" }, groups: [] })));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getWorkspaceChannel(id);
  }

  updateWorkspaceChannel(id, input) {
    const existing = this.getWorkspaceChannel(id, { includeSecrets: true });
    if (!existing) return null;
    const secret = input.webhookSecret === undefined || input.webhookSecret === "••••••••" ? existing.webhookSecret : cleanText(input.webhookSecret, "", 500);
    const assistantAgentConfigId = input.assistantAgentConfigId === undefined ? existing.assistantAgentConfigId : this.agentConfigReference(input.assistantAgentConfigId);
    const nextConfig = input.config === undefined ? existing.config : objectValue(input.config);
    if (existing.provider === "website" && nextConfig.heroButtonUrl && !isHttpUrl(nextConfig.heroButtonUrl)) {
      throw new TypeError("首页按钮跳转地址必须是完整的 HTTP 或 HTTPS 地址");
    }
    this.db.prepare(`UPDATE workspace_channels SET name = ?, enabled = ?, webhook_secret = ?, assistant_agent_config_id = ?, draft_config_json = ?, updated_at = ? WHERE id = ?`)
      .run(cleanText(input.name, existing.name, 120) || existing.name, input.enabled === undefined ? Number(existing.enabled) : (input.enabled ? 1 : 0), secret, assistantAgentConfigId, JSON.stringify(nextConfig), isoNow(), id);
    this.db.prepare("UPDATE channel_accounts SET name = ?, enabled = ?, webhook_secret = ?, updated_at = ? WHERE workspace_channel_id = ?")
      .run(cleanText(input.name, existing.name, 120) || existing.name, input.enabled === undefined ? Number(existing.enabled) : (input.enabled ? 1 : 0), secret, isoNow(), id);
    return this.getWorkspaceChannel(id);
  }

  listDeployments(workspaceId) {
    return this.db.prepare(`
      SELECT d.*, c.workspace_id, c.provider, c.name AS channel_name, p.name AS person_name, p.title AS person_title, p.avatar_url
      FROM channel_deployments d
      JOIN workspace_channels c ON c.id = d.workspace_channel_id
      JOIN people p ON p.id = d.person_id
      WHERE c.workspace_id = ? ORDER BY c.created_at, d.sort_order, d.created_at
    `).all(workspaceId).map(deploymentView);
  }

  getDeployment(id) {
    const row = this.db.prepare(`
      SELECT d.*, c.workspace_id, c.provider, c.name AS channel_name, p.name AS person_name, p.title AS person_title, p.avatar_url
      FROM channel_deployments d JOIN workspace_channels c ON c.id = d.workspace_channel_id JOIN people p ON p.id = d.person_id
      WHERE d.id = ?
    `).get(id);
    return row ? deploymentView(row) : null;
  }

  createDeployment(workspaceId, input) {
    const channel = this.getWorkspaceChannel(input.workspaceChannelId);
    const person = this.getPerson(input.personId);
    if (!channel || !person || channel.workspaceId !== workspaceId || person.workspaceId !== workspaceId) throw new TypeError("Channel and person must belong to workspace");
    const id = identifier(input.id);
    const accountId = identifier(input.accountId || id);
    const publicSlug = identifier(input.publicSlug || id);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`INSERT INTO channel_accounts (id, provider, name, enabled, accent, webhook_secret, config_json, workspace_id, person_id, workspace_channel_id, deployment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(accountId, channel.provider, `${person.name} · ${channel.name}`, input.enabled === false ? 0 : 1, this.getWorkspace(workspaceId).accent, channel.webhookSecret || "", JSON.stringify({ delivery: "poll" }), workspaceId, person.id, channel.id, id);
      this.db.prepare(`INSERT INTO channel_deployments (id, workspace_channel_id, person_id, account_id, public_slug, enabled, sort_order, draft_config_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, channel.id, person.id, accountId, publicSlug, input.enabled === false ? 0 : 1, safeInteger(input.sortOrder), JSON.stringify(objectValue(input.config)));
      this.db.prepare("UPDATE people SET config_account_id = COALESCE(NULLIF(config_account_id, ''), ?), updated_at = ? WHERE id = ?").run(accountId, isoNow(), person.id);
      this.db.prepare("INSERT INTO state_machine_configs (account_id, config_json, enabled) VALUES (?, ?, 0)").run(accountId, JSON.stringify(defaultFlowConfig(person.name)));
      this.db.prepare("INSERT INTO tag_schemas (account_id, config_json) VALUES (?, ?)").run(accountId, JSON.stringify(normalizeStoredTagSchema({ dateTag: { enabled: true, cutoffTime: "00:00" }, groups: [] })));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getDeployment(id);
  }

  updateDeployment(id, input) {
    const existing = this.getDeployment(id);
    if (!existing) return null;
    const publicSlug = input.publicSlug === undefined ? existing.publicSlug : identifier(input.publicSlug);
    this.db.prepare(`UPDATE channel_deployments SET public_slug = ?, enabled = ?, sort_order = ?, draft_config_json = ?, updated_at = ? WHERE id = ?`)
      .run(publicSlug, input.enabled === undefined ? Number(existing.enabled) : (input.enabled ? 1 : 0), input.sortOrder === undefined ? existing.sortOrder : safeInteger(input.sortOrder), JSON.stringify(input.config === undefined ? existing.config : objectValue(input.config)), isoNow(), id);
    this.db.prepare("UPDATE channel_accounts SET enabled = ?, updated_at = ? WHERE id = ?").run(input.enabled === undefined ? Number(existing.enabled) : (input.enabled ? 1 : 0), isoNow(), existing.accountId);
    return this.getDeployment(id);
  }

  publishWorkspaceChannel(id) {
    const channel = this.getWorkspaceChannel(id);
    if (!channel) return null;
    const timestamp = isoNow();
    this.db.prepare(`UPDATE workspace_channels SET published_config_json = draft_config_json, published_version = published_version + 1, published_at = ?, updated_at = ? WHERE id = ?`).run(timestamp, timestamp, id);
    this.db.prepare(`UPDATE channel_deployments
      SET published_config_json = COALESCE((SELECT profile_json FROM people WHERE people.id = channel_deployments.person_id), '{}'),
          published_version = published_version + 1, published_at = ?, updated_at = ?
      WHERE workspace_channel_id = ?`).run(timestamp, timestamp, id);
    return this.getWorkspaceChannel(id);
  }

  listAgentConfigs({ includeSecrets = false } = {}) {
    return this.db.prepare("SELECT * FROM agent_configs ORDER BY created_at, id").all().map((row) => agentConfigView(row, includeSecrets));
  }

  getAgentConfig(id, { includeSecrets = false } = {}) {
    const row = this.db.prepare("SELECT * FROM agent_configs WHERE id = ?").get(id);
    return row ? agentConfigView(row, includeSecrets) : null;
  }

  createAgentConfig(input) {
    const id = identifier(input.id);
    const name = requiredText(input.name, "Agent config name", 120);
    this.db.prepare(`INSERT INTO agent_configs (id, name, agent_api_url, agent_api_key, agent_id, concurrency_limit, billing_label) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, cleanText(input.agentApiUrl, "", 2000), cleanText(input.agentApiKey, "", 2000), cleanText(input.agentId, "", 200), 0, "");
    return this.getAgentConfig(id);
  }

  updateAgentConfig(id, input) {
    const existing = this.getAgentConfig(id, { includeSecrets: true });
    if (!existing) return null;
    const key = input.agentApiKey === undefined || input.agentApiKey === "••••••••" ? existing.agentApiKey : cleanText(input.agentApiKey, "", 2000);
    this.db.prepare(`UPDATE agent_configs SET name = ?, agent_api_url = ?, agent_api_key = ?, agent_id = ?, concurrency_limit = ?, billing_label = ?, updated_at = ? WHERE id = ?`)
      .run(cleanText(input.name, existing.name, 120) || existing.name, cleanText(input.agentApiUrl, existing.agentApiUrl, 2000), key, cleanText(input.agentId, existing.agentId, 200), 0, "", isoNow(), id);
    return this.getAgentConfig(id);
  }

  deleteAgentConfig(id) {
    const existing = this.getAgentConfig(id);
    if (!existing) return false;
    if (existing.isDefault) throw new TypeError("Default Agent config cannot be deleted");
    const used = this.db.prepare("SELECT 1 FROM people WHERE agent_config_id = ? UNION ALL SELECT 1 FROM workspace_channels WHERE assistant_agent_config_id = ? LIMIT 1").get(id, id);
    if (used) throw new TypeError("Agent config is currently bound");
    this.db.prepare("DELETE FROM agent_configs WHERE id = ?").run(id);
    return true;
  }

  saveAgentDefaults({ defaultAgentConfigId, personAgentConfigId, assistantAgentConfigId }) {
    const defaultId = this.agentConfigReference(defaultAgentConfigId || personAgentConfigId || assistantAgentConfigId);
    if (!defaultId) throw new TypeError("Default Agent config is required");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE agent_configs SET default_for_person = CASE WHEN id = ? THEN 1 ELSE 0 END, default_for_assistant = CASE WHEN id = ? THEN 1 ELSE 0 END, updated_at = ?").run(defaultId, defaultId, isoNow());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.agentDefaults();
  }

  agentDefaults() {
    const defaultAgentConfigId = this.db.prepare("SELECT id FROM agent_configs WHERE default_for_person = 1 ORDER BY created_at, id LIMIT 1").get()?.id || "";
    return { defaultAgentConfigId };
  }

  agentConfigReference(value) {
    const id = cleanText(value, "", 80);
    if (id && !this.getAgentConfig(id)) throw new TypeError("Agent config not found");
    return id || null;
  }

  getAgentBinding(scopeType, scopeId, { includeSecrets = false } = {}) {
    const row = this.db.prepare("SELECT * FROM agent_bindings WHERE scope_type = ? AND scope_id = ?").get(scopeType, scopeId);
    return row ? bindingView(row, includeSecrets) : null;
  }

  saveAgentBinding(scopeType, scopeId, input) {
    if (!["platform", "workspace", "person", "assistant"].includes(scopeType)) throw new TypeError("Invalid Agent binding scope");
    if (scopeType === "platform" && scopeId !== "default") throw new TypeError("Invalid platform scope");
    if (scopeType === "workspace" && !this.getWorkspace(scopeId)) throw new TypeError("Workspace not found");
    if (scopeType === "person" && !this.getPerson(scopeId)) throw new TypeError("Person not found");
    if (scopeType === "assistant" && !this.getWorkspaceChannel(scopeId)) throw new TypeError("Channel not found");
    const existing = this.getAgentBinding(scopeType, scopeId, { includeSecrets: true });
    const key = input.agentApiKey === undefined || input.agentApiKey === "••••••••" ? existing?.agentApiKey || "" : cleanText(input.agentApiKey, "", 2000);
    const value = {
      id: existing?.id || `${scopeType}-${scopeId}`,
      name: cleanText(input.name, existing?.name || "", 120),
      enabled: input.enabled === undefined ? existing?.enabled !== false : Boolean(input.enabled),
      agentApiUrl: cleanText(input.agentApiUrl, existing?.agentApiUrl || "", 2000),
      agentApiKey: key,
      agentId: cleanText(input.agentId, existing?.agentId || "", 200),
      concurrencyLimit: Math.max(0, safeInteger(input.concurrencyLimit ?? existing?.concurrencyLimit)),
      billingLabel: cleanText(input.billingLabel, existing?.billingLabel || "", 120)
    };
    this.db.prepare(`INSERT INTO agent_bindings (id, scope_type, scope_id, name, enabled, agent_api_url, agent_api_key, agent_id, concurrency_limit, billing_label, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope_type, scope_id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled, agent_api_url = excluded.agent_api_url, agent_api_key = excluded.agent_api_key, agent_id = excluded.agent_id, concurrency_limit = excluded.concurrency_limit, billing_label = excluded.billing_label, updated_at = excluded.updated_at`)
      .run(value.id, scopeType, scopeId, value.name, value.enabled ? 1 : 0, value.agentApiUrl, value.agentApiKey, value.agentId, value.concurrencyLimit, value.billingLabel, isoNow());
    return this.getAgentBinding(scopeType, scopeId);
  }

  resolveAgentBindingForAccount(accountId, { includeSecrets = false } = {}) {
    const row = this.db.prepare("SELECT * FROM channel_accounts WHERE id = ?").get(accountId);
    if (!row) return null;
    return resolveBinding(this.db, row, includeSecrets);
  }

  channelPreview(id, { published = false } = {}) {
    const deployment = this.getDeployment(id);
    if (!deployment) return null;
    const workspace = this.getWorkspace(deployment.workspaceId);
    const person = this.getPerson(deployment.personId);
    const channel = this.getWorkspaceChannel(deployment.workspaceChannelId);
    const allDeployments = this.listDeployments(deployment.workspaceId);
    const deployments = allDeployments
      .filter((item) => item.workspaceChannelId === channel.id)
      .map((item) => ({ item, person: this.getPerson(item.personId) }))
      .filter(({ item, person: deployedPerson }) => !published || (item.enabled && deployedPerson?.enabled))
      .map(({ item, person: deployedPerson }) => ({
        ...item,
        config: { ...(published ? item.publishedConfig : deployedPerson?.profile || {}) },
        channelOverrides: published ? item.publishedConfig : item.config,
        person: deployedPerson ? {
          id: deployedPerson.id,
          name: deployedPerson.name,
          title: deployedPerson.title,
          avatarUrl: deployedPerson.avatarUrl
        } : null
      }));
    return {
      schemaVersion: 2,
      mode: published ? "published" : "draft",
      channelType: channel.provider,
      workspace,
      person,
      channel: { ...channel, config: published ? channel.publishedConfig : channel.config },
      deployment: {
        ...deployment,
        config: { ...(published ? deployment.publishedConfig : person.profile || {}) },
        channelOverrides: published ? deployment.publishedConfig : deployment.config
      },
      deployments,
      endpoints: channelEndpoints(deployment.accountId, channel.provider, deployment.publicSlug, {
        deploymentId: deployment.id,
        assistantAccountId: channel.assistantAccountId,
        preview: !published
      })
    };
  }

  workspaceChannelPreview(id) {
    const channel = this.getWorkspaceChannel(id);
    if (!channel) return null;
    const selectedDeployment = this.listDeployments(channel.workspaceId)
      .find((item) => item.workspaceChannelId === channel.id && item.enabled)
      || this.listDeployments(channel.workspaceId).find((item) => item.workspaceChannelId === channel.id);
    if (selectedDeployment) return this.channelPreview(selectedDeployment.id);
    const workspace = this.getWorkspace(channel.workspaceId);
    const person = { id: "channel-preview-person", workspaceId: workspace.id, name: "张三", title: "智能员工", avatarUrl: "", enabled: true, persona: {}, profile: { companyName: workspace.name } };
    const deployment = {
      id: `channel-preview-${channel.id}`,
      workspaceId: workspace.id,
      workspaceChannelId: channel.id,
      personId: person.id,
      personName: person.name,
      personTitle: person.title,
      avatarUrl: "",
      accountId: channel.assistantAccountId,
      publicSlug: "",
      enabled: true,
      sortOrder: 0,
      config: person.profile,
      person
    };
    return {
      schemaVersion: 3,
      mode: "draft",
      previewOnly: true,
      channelType: channel.provider,
      workspace,
      person,
      channel,
      deployment,
      deployments: [deployment],
      endpoints: {}
    };
  }

  publicChannel(publicSlug) {
    const deployment = this.db.prepare("SELECT id FROM channel_deployments WHERE public_slug = ? AND enabled = 1").get(publicSlug);
    if (!deployment) return null;
    const payload = this.channelPreview(deployment.id, { published: true });
    if (!payload?.workspace.enabled || !payload.person.enabled || !payload.channel.enabled || payload.channel.publishedVersion < 1) return null;
    delete payload.workspace.companyContext;
    delete payload.person.persona;
    delete payload.person.profile;
    delete payload.person.configurationAccountId;
    delete payload.channel.webhookSecret;
    delete payload.channel.assistantAccountId;
    return payload;
  }

  recordAgentUsage({ bindingId = null, accountId, workspaceId = null, personId = null, conversationId = null, status, durationMs = 0, requestId = "", error = "" }) {
    this.db.prepare(`INSERT INTO agent_usage_logs (binding_id, account_id, workspace_id, person_id, conversation_id, status, duration_ms, request_id, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(bindingId, accountId, workspaceId, personId, conversationId, cleanText(status, "unknown", 40), Math.max(0, safeInteger(durationMs)), cleanText(requestId, "", 200), cleanText(error, "", 2000));
  }

  dashboard(accountId) {
    const account = this.db.prepare("SELECT id, person_id FROM channel_accounts WHERE id = ?").get(accountId);
    const accountRows = account?.person_id
      ? this.db.prepare("SELECT id, provider, name, enabled FROM channel_accounts WHERE person_id = ? ORDER BY provider, id").all(account.person_id)
      : this.db.prepare("SELECT id, provider, name, enabled FROM channel_accounts WHERE id = ?").all(accountId);
    const accountIds = accountRows.map((item) => item.id);
    if (!accountIds.length) return emptyDashboard();

    const slots = accountIds.map(() => "?").join(", ");
    const todayStart = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', 'localtime', 'start of day', 'utc')";
    const weekStart = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days', 'localtime', 'start of day', 'utc')";
    const hasCollectedData = `EXISTS (
      SELECT 1 FROM json_each(CASE WHEN json_valid(fs.collected_data_json) THEN fs.collected_data_json ELSE '{}' END) field
      WHERE trim(CAST(field.value AS TEXT)) <> ''
    )`;

    const totals = this.db.prepare(`
      SELECT
        COUNT(*) AS conversations,
        SUM(CASE WHEN created_at >= ${todayStart} THEN 1 ELSE 0 END) AS visitors_today,
        SUM(CASE WHEN mode = 'human' THEN 1 ELSE 0 END) AS human_count,
        SUM(CASE WHEN unread_count > 0 THEN 1 ELSE 0 END) AS unread_count
      FROM conversations WHERE account_id IN (${slots})
    `).get(...accountIds);
    const messages = this.db.prepare(`
      SELECT
        SUM(CASE WHEN m.created_at >= ${todayStart} AND m.direction = 'inbound' THEN 1 ELSE 0 END) AS inbound_today,
        SUM(CASE WHEN m.created_at >= ${todayStart} AND m.direction = 'outbound' AND m.sender_type = 'agent' THEN 1 ELSE 0 END) AS agent_today,
        SUM(CASE WHEN m.created_at >= ${todayStart} AND m.direction = 'outbound' AND m.sender_type = 'human' THEN 1 ELSE 0 END) AS human_today
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id IN (${slots})
    `).get(...accountIds);
    const alerts = this.db.prepare(`
      SELECT COUNT(*) AS count FROM attention_alerts alert
      JOIN conversations c ON c.id = alert.conversation_id
      WHERE c.account_id IN (${slots}) AND alert.status = 'open'
    `).get(...accountIds);
    const leads = this.db.prepare(`
      SELECT COUNT(*) AS count FROM flow_sessions fs
      WHERE fs.account_id IN (${slots}) AND ${hasCollectedData}
    `).get(...accountIds);
    const leadsToday = this.db.prepare(`
      SELECT COUNT(DISTINCT event.conversation_id) AS count FROM flow_state_events event
      WHERE event.account_id IN (${slots}) AND event.created_at >= ${todayStart}
        AND EXISTS (
          SELECT 1 FROM json_each(CASE WHEN json_valid(event.collected_data_patch_json) THEN event.collected_data_patch_json ELSE '{}' END) field
          WHERE trim(CAST(field.value AS TEXT)) <> ''
        )
    `).get(...accountIds);
    const agent = this.db.prepare(`
      SELECT
        COUNT(*) AS requests,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'fallback' THEN 1 ELSE 0 END) AS fallback,
        AVG(CASE WHEN status = 'succeeded' THEN duration_ms END) AS avg_duration_ms
      FROM agent_usage_logs
      WHERE account_id IN (${slots}) AND created_at >= ${weekStart}
    `).get(...accountIds);
    const handoffsToday = this.db.prepare(`
      SELECT COUNT(*) AS count FROM handoff_events handoff
      JOIN conversations c ON c.id = handoff.conversation_id
      WHERE c.account_id IN (${slots}) AND handoff.to_mode = 'human' AND handoff.created_at >= ${todayStart}
    `).get(...accountIds)?.count || 0;
    const states = this.db.prepare(`SELECT state, COUNT(*) AS count FROM conversations WHERE account_id IN (${slots}) GROUP BY state ORDER BY count DESC`).all(...accountIds);

    const channelRows = this.db.prepare(`
      SELECT account.id, account.provider, account.name, account.enabled,
        (SELECT COUNT(*) FROM conversations c WHERE c.account_id = account.id) AS conversations,
        (SELECT COUNT(*) FROM conversations c WHERE c.account_id = account.id AND c.created_at >= ${todayStart}) AS visitors_today,
        (SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.account_id = account.id AND m.direction = 'inbound' AND m.created_at >= ${todayStart}) AS messages_today,
        (SELECT COUNT(*) FROM flow_sessions fs WHERE fs.account_id = account.id AND ${hasCollectedData}) AS leads,
        (SELECT COUNT(*) FROM attention_alerts alert JOIN conversations c ON c.id = alert.conversation_id WHERE c.account_id = account.id AND alert.status = 'open') AS open_alerts,
        (SELECT COUNT(*) FROM conversations c WHERE c.account_id = account.id AND c.mode = 'human') AS human_count
      FROM channel_accounts account WHERE account.id IN (${slots}) ORDER BY account.provider, account.id
    `).all(...accountIds);
    const channelAgentRows = this.db.prepare(`
      SELECT account_id,
        COUNT(*) AS requests,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
        AVG(CASE WHEN status = 'succeeded' THEN duration_ms END) AS avg_duration_ms
      FROM agent_usage_logs WHERE account_id IN (${slots}) AND created_at >= ${weekStart} GROUP BY account_id
    `).all(...accountIds);
    const channelAgentById = new Map(channelAgentRows.map((item) => [item.account_id, item]));

    const trendRows = this.db.prepare(`
      WITH RECURSIVE days(day) AS (
        SELECT date('now', 'localtime', '-6 days')
        UNION ALL SELECT date(day, '+1 day') FROM days WHERE day < date('now', 'localtime')
      )
      SELECT days.day,
        (SELECT COUNT(*) FROM conversations c WHERE c.account_id IN (${slots}) AND date(c.created_at, 'localtime') = days.day) AS visitors,
        (SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.account_id IN (${slots}) AND m.direction = 'inbound' AND date(m.created_at, 'localtime') = days.day) AS messages,
        (SELECT COUNT(DISTINCT event.conversation_id) FROM flow_state_events event WHERE event.account_id IN (${slots}) AND date(event.created_at, 'localtime') = days.day AND EXISTS (
          SELECT 1 FROM json_each(CASE WHEN json_valid(event.collected_data_patch_json) THEN event.collected_data_patch_json ELSE '{}' END) field
          WHERE trim(CAST(field.value AS TEXT)) <> ''
        )) AS leads
      FROM days ORDER BY days.day
    `).all(...accountIds, ...accountIds, ...accountIds);
    const recentAlerts = this.db.prepare(`
      SELECT alert.*, c.display_name, c.account_id, account.provider
      FROM attention_alerts alert
      JOIN conversations c ON c.id = alert.conversation_id
      JOIN channel_accounts account ON account.id = c.account_id
      WHERE c.account_id IN (${slots}) AND alert.status = 'open'
      ORDER BY alert.created_at DESC LIMIT 6
    `).all(...accountIds);

    const agentRequests = Number(agent?.requests || 0);
    const agentSucceeded = Number(agent?.succeeded || 0);
    const agentFailed = Number(agent?.failed || 0);
    const rateBase = agentSucceeded + agentFailed;
    const channels = channelRows.map((item) => {
      const usage = channelAgentById.get(item.id);
      const succeeded = Number(usage?.succeeded || 0);
      const requests = Number(usage?.requests || 0);
      return {
        accountId: item.id,
        provider: item.provider,
        name: item.name,
        enabled: Boolean(item.enabled),
        conversations: Number(item.conversations || 0),
        visitorsToday: Number(item.visitors_today || 0),
        messagesToday: Number(item.messages_today || 0),
        leads: Number(item.leads || 0),
        openAlerts: Number(item.open_alerts || 0),
        humanCount: Number(item.human_count || 0),
        agentRequests: requests,
        agentSuccessRate: requests ? Math.round(succeeded / requests * 1000) / 10 : null,
        avgDurationMs: Math.round(Number(usage?.avg_duration_ms || 0))
      };
    });

    return {
      conversations: Number(totals?.conversations || 0),
      humanCount: Number(totals?.human_count || 0),
      unreadCount: Number(totals?.unread_count || 0),
      messagesToday: Number(messages?.inbound_today || 0) + Number(messages?.agent_today || 0) + Number(messages?.human_today || 0),
      openAlerts: Number(alerts?.count || 0),
      scope: { type: account?.person_id ? "employee" : "account", personId: account?.person_id || null, accountIds },
      today: {
        visitors: Number(totals?.visitors_today || 0),
        inboundMessages: Number(messages?.inbound_today || 0),
        agentReplies: Number(messages?.agent_today || 0),
        humanReplies: Number(messages?.human_today || 0),
        leads: Number(leadsToday?.count || 0),
        handoffs: Number(handoffsToday)
      },
      totals: {
        conversations: Number(totals?.conversations || 0),
        leads: Number(leads?.count || 0),
        activeHuman: Number(totals?.human_count || 0),
        unreadConversations: Number(totals?.unread_count || 0),
        openAlerts: Number(alerts?.count || 0)
      },
      agent: {
        periodDays: 7,
        requests: agentRequests,
        succeeded: agentSucceeded,
        failed: agentFailed,
        fallback: Number(agent?.fallback || 0),
        successRate: rateBase ? Math.round(agentSucceeded / rateBase * 1000) / 10 : null,
        avgDurationMs: Math.round(Number(agent?.avg_duration_ms || 0))
      },
      states: states.map((item) => ({ state: item.state, count: Number(item.count || 0) })),
      channels,
      trend: trendRows.map((item) => ({ day: item.day, visitors: Number(item.visitors || 0), messages: Number(item.messages || 0), leads: Number(item.leads || 0) })),
      alerts: recentAlerts.map((item) => ({
        id: Number(item.id),
        conversationId: Number(item.conversation_id),
        accountId: item.account_id,
        provider: item.provider,
        messageId: item.message_id ? Number(item.message_id) : null,
        title: item.title,
        detail: item.detail,
        status: item.status,
        displayName: item.display_name,
        createdAt: item.created_at
      }))
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
      SELECT conversation_id, group_id, group_name, tag_id, tag_name, reason, source, created_at
      FROM conversation_rule_tags WHERE account_id = ? ORDER BY created_at, tag_id
    `).all(accountId).map(ruleTagView);
    const byConversation = Map.groupBy(tags, (item) => Number(item.conversationId));
    return rows.map((row) => ({ ...conversationView(row), tags: byConversation.get(Number(row.id)) || [] }));
  }

  getConversation(id) {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    if (!row) return null;
    return { ...conversationView(row), tags: this.listConversationTags(id), flowSession: this.getFlowSession(id) };
  }

  listMessages(conversationId) {
    return this.db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 1000").all(conversationId).map(messageView);
  }

  conversationContext(conversationId, limit = 20) {
    return this.db.prepare(`SELECT id, direction, sender_type, message_type, content, metadata_json, created_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`).all(conversationId, limit).reverse().map((row) => ({
      id: Number(row.id), direction: row.direction, senderType: row.sender_type, messageType: row.message_type,
      content: row.content, metadata: json(row.metadata_json), createdAt: row.created_at
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
      this.db.prepare("UPDATE activation_tasks SET status = 'canceled', updated_at = ? WHERE conversation_id IN (SELECT id FROM conversations WHERE account_id = ? AND external_conversation_id = ?) AND status IN ('pending', 'processing')").run(now, event.accountId, event.externalConversationId);
      const machine = this.getFlowMachine(event.accountId);
      const initialState = String(machine.config.entryNodeId || "new");
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
      this.getOrCreateFlowSession(Number(conversation.id), event.accountId, machine);
      this.ensureDateTag(Number(conversation.id), event.accountId, now);
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

  setConversationState(id, state, reason = "manual") {
    const conversation = this.getConversation(id);
    if (!conversation) return null;
    const machine = this.getFlowMachine(conversation.accountId);
    if (!machine.config.nodes.some((item) => item.id === state)) throw new TypeError("Unknown flow node");
    const session = this.getOrCreateFlowSession(id, conversation.accountId, machine);
    if (session.currentNodeId === state) return conversation;
    const timestamp = isoNow();
    this.db.prepare("UPDATE flow_sessions SET current_node_id = ?, status = 'active', entered_at = ?, completed_at = NULL, updated_at = ? WHERE conversation_id = ?").run(state, timestamp, timestamp, id);
    this.db.prepare("UPDATE conversations SET state = ?, updated_at = ? WHERE id = ?").run(state, timestamp, id);
    this.db.prepare("INSERT INTO flow_state_events (conversation_id, account_id, from_node_id, to_node_id, node_completed, reason, source) VALUES (?, ?, ?, ?, 0, ?, ?)").run(id, conversation.accountId, session.currentNodeId, state, cleanText(reason, "manual", 1000), reason === "manual" ? "manual" : "agent");
    this.audit(conversation.accountId, id, "flow", "flow.node_changed", { from: session.currentNodeId, to: state, reason });
    return this.getConversation(id);
  }

  markRead(id) {
    this.db.prepare("UPDATE conversations SET unread_count = 0, updated_at = ? WHERE id = ?").run(isoNow(), id);
  }

  resetConversation(id) {
    const conversation = this.getConversation(id);
    if (!conversation) return false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM channel_outbox WHERE account_id = ? AND external_conversation_id = ?").run(conversation.accountId, conversation.externalConversationId);
      this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
      this.audit(conversation.accountId, null, "conversation", "conversation.reset", {
        previousConversationId: id,
        externalConversationId: conversation.externalConversationId,
        displayName: conversation.displayName
      });
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getStateMachine(accountId) {
    return this.getFlowMachine(accountId);
  }

  saveStateMachine(accountId, input) {
    return this.saveFlowMachine(accountId, input?.config ? input : { enabled: input?.enabled, config: input });
  }

  getFlowMachine(accountId, { useDefault = false } = {}) {
    const configurationAccountId = this.configurationAccountId(accountId);
    const row = this.db.prepare("SELECT config_json, enabled, updated_at FROM state_machine_configs WHERE account_id = ?").get(configurationAccountId);
    let raw = json(row?.config_json, null);
    if (!raw?.nodes) raw = defaultFlowConfig(this.getAccount(accountId)?.name || "客服");
    const config = normalizeFlowConfig(raw);
    return { accountId, configurationAccountId, enabled: useDefault ? false : Boolean(row?.enabled), config, updatedAt: row?.updated_at || null };
  }

  saveFlowMachine(accountId, input = {}) {
    if (!this.getAccount(accountId)) throw new TypeError("Channel account not found");
    const config = normalizeFlowConfig(input.config || input);
    const enabled = input.enabled !== false;
    const timestamp = isoNow();
    const configurationAccountId = this.configurationAccountId(accountId);
    this.db.prepare(`INSERT INTO state_machine_configs (account_id, config_json, enabled, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET config_json = excluded.config_json, enabled = excluded.enabled, updated_at = excluded.updated_at`).run(configurationAccountId, JSON.stringify(config), enabled ? 1 : 0, timestamp);
    this.audit(accountId, null, "configuration", "flow_machine.updated", { enabled, nodeCount: config.nodes.length, version: config.version });
    return this.getFlowMachine(accountId);
  }

  getOrCreateFlowSession(conversationId, accountId, machine = this.getFlowMachine(accountId)) {
    let row = this.db.prepare("SELECT * FROM flow_sessions WHERE conversation_id = ?").get(conversationId);
    if (!row) {
      const timestamp = isoNow();
      this.db.prepare("INSERT INTO flow_sessions (conversation_id, account_id, current_node_id, created_at, updated_at, entered_at) VALUES (?, ?, ?, ?, ?, ?)").run(conversationId, accountId, machine.config.entryNodeId, timestamp, timestamp, timestamp);
      row = this.db.prepare("SELECT * FROM flow_sessions WHERE conversation_id = ?").get(conversationId);
    }
    return flowSessionView(row);
  }

  getFlowSession(conversationId) {
    return flowSessionView(this.db.prepare("SELECT * FROM flow_sessions WHERE conversation_id = ?").get(conversationId));
  }

  getFlowContext(conversationId) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return null;
    const machine = this.getFlowMachine(conversation.accountId);
    const session = this.getOrCreateFlowSession(conversationId, conversation.accountId, machine);
    return { machine, session };
  }

  applyFlowDecision(conversationId, decision, source = "agent") {
    if (!decision) return this.getFlowSession(conversationId);
    const conversation = this.getConversation(conversationId);
    if (!conversation) return null;
    const session = this.getOrCreateFlowSession(conversationId, conversation.accountId);
    const collectedData = { ...session.collectedData, ...(decision.collectedDataPatch || {}) };
    const toNodeId = decision.nodeCompleted && decision.nextNodeId ? decision.nextNodeId : session.currentNodeId;
    const completed = Boolean(decision.nodeCompleted && !decision.nextNodeId);
    const timestamp = isoNow();
    this.db.prepare(`UPDATE flow_sessions SET current_node_id = ?, collected_data_json = ?, status = ?, entered_at = CASE WHEN current_node_id <> ? THEN ? ELSE entered_at END, completed_at = ?, updated_at = ? WHERE conversation_id = ?`).run(toNodeId, JSON.stringify(collectedData), completed ? "completed" : "active", toNodeId, timestamp, completed ? timestamp : null, timestamp, conversationId);
    this.db.prepare("UPDATE conversations SET state = ?, updated_at = ? WHERE id = ?").run(toNodeId, timestamp, conversationId);
    this.db.prepare(`INSERT INTO flow_state_events (conversation_id, account_id, from_node_id, to_node_id, node_completed, collected_data_patch_json, reason, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(conversationId, conversation.accountId, session.currentNodeId, toNodeId, decision.nodeCompleted ? 1 : 0, JSON.stringify(decision.collectedDataPatch || {}), cleanText(decision.reason, "", 1000), source);
    this.audit(conversation.accountId, conversationId, "flow", decision.nodeCompleted ? "flow.node_completed" : "flow.evaluated", { from: session.currentNodeId, to: toNodeId, collectedDataPatch: decision.collectedDataPatch || {}, reason: decision.reason || "" });
    return this.getFlowSession(conversationId);
  }

  listFlowEvents(conversationId) {
    return this.db.prepare("SELECT * FROM flow_state_events WHERE conversation_id = ? ORDER BY id").all(conversationId).map((row) => ({ id: Number(row.id), fromNodeId: row.from_node_id, toNodeId: row.to_node_id, nodeCompleted: Boolean(row.node_completed), collectedDataPatch: json(row.collected_data_patch_json), reason: row.reason, source: row.source, createdAt: row.created_at }));
  }

  scheduleActivation(conversationId, { sourceType, sourceKey, activation, anchorAt = isoNow() }) {
    if (!activation?.enabled || !Array.isArray(activation.messages)) return [];
    const conversation = this.getConversation(conversationId);
    if (!conversation) return [];
    this.db.prepare("UPDATE activation_tasks SET status = 'canceled', updated_at = ? WHERE conversation_id = ? AND source_type = ? AND source_key = ? AND status = 'pending'").run(isoNow(), conversationId, sourceType, sourceKey);
    let dueMs = Number.isFinite(Date.parse(anchorAt)) ? Date.parse(anchorAt) : Date.now();
    const ids = [];
    const insert = this.db.prepare(`INSERT INTO activation_tasks (conversation_id, account_id, source_type, source_key, message_index, sequence_no, content, polish_by_agent, due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    activation.messages.forEach((message, messageIndex) => {
      const content = cleanText(message?.content, "", 20_000);
      if (!content) return;
      const delayMs = Math.max(0, Number(message.intervalMinutes) || 0) === 0 ? 5_000 : Math.max(0, Number(message.intervalMinutes) || 0) * 60_000;
      const maxTimes = Math.max(1, Number.parseInt(message.maxTimes ?? 1, 10) || 1);
      for (let sequence = 1; sequence <= maxTimes; sequence += 1) {
        dueMs += delayMs;
        const result = insert.run(conversationId, conversation.accountId, sourceType, cleanText(sourceKey, "", 200), messageIndex, sequence, content, activation.polishByAgent === false ? 0 : 1, new Date(dueMs).toISOString());
        ids.push(Number(result.lastInsertRowid));
      }
    });
    if (ids.length) this.audit(conversation.accountId, conversationId, "activation", "activation.scheduled", { sourceType, sourceKey, taskCount: ids.length });
    return ids;
  }

  claimDueActivations(limit = 20) {
    const rows = this.db.prepare(`SELECT * FROM activation_tasks WHERE status = 'pending' AND due_at <= ? ORDER BY due_at, id LIMIT ?`).all(isoNow(), limit);
    const claimed = [];
    const claim = this.db.prepare("UPDATE activation_tasks SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'pending'");
    for (const row of rows) if (claim.run(isoNow(), row.id).changes) claimed.push(activationTaskView(row));
    return claimed;
  }

  finishActivation(id, { status, error = "" }) {
    if (!["sent", "failed", "canceled"].includes(status)) throw new TypeError("Invalid activation status");
    const condition = status === "canceled" ? "status IN ('pending', 'processing')" : "status = 'processing'";
    return Boolean(this.db.prepare(`UPDATE activation_tasks SET status = ?, last_error = ?, updated_at = ? WHERE id = ? AND ${condition}`).run(status, cleanText(error, "", 1000), isoNow(), id).changes);
  }

  isActivationProcessing(id) {
    return this.db.prepare("SELECT 1 FROM activation_tasks WHERE id = ? AND status = 'processing'").get(id) !== undefined;
  }

  getTagSchema(accountId) {
    const configurationAccountId = this.configurationAccountId(accountId);
    const row = this.db.prepare("SELECT config_json, updated_at FROM tag_schemas WHERE account_id = ?").get(configurationAccountId);
    return { accountId, configurationAccountId, config: normalizeStoredTagSchema(json(row?.config_json, { dateTag: { enabled: true, cutoffTime: "00:00" }, groups: [] })), updatedAt: row?.updated_at || null };
  }

  saveTagSchema(accountId, schema) {
    if (!this.getAccount(accountId)) throw new TypeError("Channel account not found");
    const config = normalizeStoredTagSchema(schema?.schema || schema);
    validateTagSchema(config);
    const timestamp = isoNow();
    const configurationAccountId = this.configurationAccountId(accountId);
    this.db.prepare(`INSERT INTO tag_schemas (account_id, config_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`).run(configurationAccountId, JSON.stringify(config), timestamp);
    this.audit(accountId, null, "configuration", "tag_schema.updated", { groupCount: config.groups.length, tagCount: config.groups.reduce((sum, group) => sum + group.tags.length, 0) });
    return this.getTagSchema(accountId);
  }

  listTags(accountId) {
    return this.getTagSchema(accountId).config.groups.flatMap((group) => group.tags.map((tag) => ({ ...tag, groupId: group.id, groupName: group.name })));
  }

  configurationAccountId(accountId) {
    return this.db.prepare(`
      SELECT COALESCE(NULLIF(p.config_account_id, ''), a.id) AS id
      FROM channel_accounts a LEFT JOIN people p ON p.id = a.person_id
      WHERE a.id = ?
    `).get(accountId)?.id || accountId;
  }

  listConversationTags(conversationId) {
    return this.db.prepare("SELECT * FROM conversation_rule_tags WHERE conversation_id = ? ORDER BY created_at, tag_id").all(conversationId).map(ruleTagView);
  }

  ensureDateTag(conversationId, accountId, at = isoNow()) {
    const schema = this.getTagSchema(accountId).config;
    if (!schema.dateTag.enabled) return;
    const tagId = dateTagIdFor(at, schema.dateTag.cutoffTime);
    this.db.prepare(`INSERT OR IGNORE INTO conversation_rule_tags (conversation_id, account_id, group_id, group_name, tag_id, tag_name, source) VALUES (?, ?, 'date', '添加日期', ?, ?, 'system')`).run(conversationId, accountId, tagId, tagId);
  }

  applyTagDecision(conversationId, decision, { source = "agent", evidenceMessageId = null } = {}) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return { tags: [], accepted: [], rejected: [] };
    const schema = this.getTagSchema(conversation.accountId).config;
    const currentTags = this.listConversationTags(conversationId).filter((tag) => tag.groupId !== "date");
    const result = adjudicateTagDecision({ schema, currentTags, decision, ignoreOneWay: source === "manual" });
    const timestamp = isoNow();
    this.db.prepare("DELETE FROM conversation_rule_tags WHERE conversation_id = ? AND group_id <> 'date'").run(conversationId);
    const insert = this.db.prepare(`INSERT INTO conversation_rule_tags (conversation_id, account_id, group_id, group_name, tag_id, tag_name, reason, evidence_message_id, evidence_text, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const tag of result.nextTags) {
      const action = result.accepted.find((item) => item.groupId === tag.groupId && item.tagId === tag.tagId);
      insert.run(conversationId, conversation.accountId, tag.groupId, tag.groupName, tag.tagId, tag.tagName || tag.name, action?.reason || tag.reason || "", action?.evidenceMessageId ? evidenceMessageId : null, action?.evidenceText || "", source, timestamp, timestamp);
    }
    const eventInsert = this.db.prepare(`INSERT INTO tag_events (conversation_id, account_id, group_id, tag_id, action, reason, evidence_message_id, evidence_text, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const action of result.accepted) {
      eventInsert.run(conversationId, conversation.accountId, action.groupId, action.tagId, action.action, action.reason || "", action.evidenceMessageId ? evidenceMessageId : null, action.evidenceText || "", source);
    }
    if (result.accepted.length || result.rejected.length) this.audit(conversation.accountId, conversationId, "tag", "tag.decision_applied", { accepted: result.accepted, rejected: result.rejected });
    return { tags: this.listConversationTags(conversationId), accepted: result.accepted, rejected: result.rejected };
  }

  assignTags(conversationId, names, { source = "manual", evidenceMessageId = null } = {}) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return [];
    const schema = this.getTagSchema(conversation.accountId).config;
    const wanted = new Set((Array.isArray(names) ? names : []).map(String));
    const add = schema.groups.flatMap((group) => group.tags.filter((tag) => wanted.has(tag.name) || wanted.has(`${group.id}:${tag.id}`)).map((tag) => ({ groupId: group.id, tagId: tag.id, reason: "manual" })));
    return this.applyTagDecision(conversationId, { add, remove: [] }, { source, evidenceMessageId }).tags;
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

function emptyDashboard() {
  return {
    conversations: 0,
    humanCount: 0,
    unreadCount: 0,
    messagesToday: 0,
    openAlerts: 0,
    scope: { type: "account", personId: null, accountIds: [] },
    today: { visitors: 0, inboundMessages: 0, agentReplies: 0, humanReplies: 0, leads: 0, handoffs: 0 },
    totals: { conversations: 0, leads: 0, activeHuman: 0, unreadConversations: 0, openAlerts: 0 },
    agent: { periodDays: 7, requests: 0, succeeded: 0, failed: 0, fallback: 0, successRate: null, avgDurationMs: 0 },
    states: [],
    channels: [],
    trend: [],
    alerts: []
  };
}

function accountView(row, includeSecrets = false, db = null) {
  const binding = db ? resolveBinding(db, row, includeSecrets) : null;
  const workspace = db && row.workspace_id ? db.prepare("SELECT * FROM workspaces WHERE id = ?").get(row.workspace_id) : null;
  const person = db && row.person_id ? db.prepare("SELECT * FROM people WHERE id = ?").get(row.person_id) : null;
  const workspaceChannel = db && row.workspace_channel_id ? db.prepare("SELECT * FROM workspace_channels WHERE id = ?").get(row.workspace_channel_id) : null;
  const result = {
    id: row.id,
    provider: row.provider,
    name: row.name,
    enabled: Boolean(row.enabled),
    accent: row.accent,
    agentApiUrl: binding?.agentApiUrl || row.agent_api_url,
    agentApiKeyConfigured: Boolean(binding?.agentApiKeyConfigured || row.agent_api_key),
    agentApiKey: binding ? binding.agentApiKey : (includeSecrets ? row.agent_api_key : row.agent_api_key ? "••••••••" : ""),
    agentId: binding?.agentId || row.agent_id,
    agentBinding: binding,
    webhookSecretConfigured: Boolean(row.webhook_secret),
    webhookSecret: includeSecrets ? row.webhook_secret : row.webhook_secret ? "••••••••" : "",
    config: json(row.config_json),
    workspaceId: row.workspace_id || null,
    workspace: workspace ? { id: workspace.id, slug: workspace.slug, name: workspace.name, accent: workspace.accent, logoUrl: workspace.logo_url, companyContext: json(workspace.company_context_json) } : null,
    personId: row.person_id || null,
    person: person ? { id: person.id, name: person.name, title: person.title, avatarUrl: person.avatar_url, persona: json(person.persona_json), profile: json(person.profile_json) } : null,
    assistantProfile: !person && workspaceChannel ? json(workspaceChannel.draft_config_json) : null,
    workspaceChannelId: row.workspace_channel_id || null,
    deploymentId: row.deployment_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  return result;
}

function workspaceView(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    enabled: Boolean(row.enabled),
    accent: row.accent,
    logoUrl: row.logo_url,
    companyContext: json(row.company_context_json),
    personCount: Number(row.person_count || 0),
    channelCount: Number(row.channel_count || 0),
    miniappStatus: row.miniapp_status || "unconfigured",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function workspaceMiniappView(row, includeSecrets = false) {
  return {
    workspaceId: row.workspace_id,
    mode: row.mode,
    name: row.name,
    appId: row.app_id,
    appSecretConfigured: Boolean(row.encrypted_app_secret),
    appSecret: includeSecrets && row.encrypted_app_secret ? "••••••••" : "",
    encryptedAppSecret: includeSecrets ? row.encrypted_app_secret : undefined,
    originalId: row.original_id || "",
    status: row.status,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function wechatVisitorView(row) {
  return {
    nickName: row.nickname || "",
    avatarUrl: row.avatar_url || "",
    profileComplete: Boolean(row.nickname),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function personView(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    title: row.title,
    avatarUrl: row.avatar_url,
    enabled: Boolean(row.enabled),
    persona: json(row.persona_json),
    profile: json(row.profile_json),
    agentConfigId: row.agent_config_id || "",
    configurationAccountId: row.config_account_id || null,
    deploymentCount: Number(row.deployment_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function channelView(row, includeSecrets = false) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    name: row.name,
    enabled: Boolean(row.enabled),
    webhookSecretConfigured: Boolean(row.webhook_secret),
    webhookSecret: includeSecrets ? row.webhook_secret : row.webhook_secret ? "••••••••" : "",
    assistantAccountId: row.assistant_account_id || null,
    assistantAgentConfigId: row.assistant_agent_config_id || "",
    config: json(row.draft_config_json),
    publishedConfig: json(row.published_config_json),
    publishedVersion: Number(row.published_version || 0),
    publishedAt: row.published_at,
    deploymentCount: Number(row.deployment_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function deploymentView(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceChannelId: row.workspace_channel_id,
    channelName: row.channel_name,
    provider: row.provider,
    personId: row.person_id,
    personName: row.person_name,
    personTitle: row.person_title,
    avatarUrl: row.avatar_url,
    accountId: row.account_id,
    publicSlug: row.public_slug,
    enabled: Boolean(row.enabled),
    sortOrder: Number(row.sort_order || 0),
    config: json(row.draft_config_json),
    publishedConfig: json(row.published_config_json),
    publishedVersion: Number(row.published_version || 0),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function bindingView(row, includeSecrets = false) {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    name: row.name,
    enabled: Boolean(row.enabled),
    agentApiUrl: row.agent_api_url,
    agentApiKeyConfigured: Boolean(row.agent_api_key),
    agentApiKey: includeSecrets ? row.agent_api_key : row.agent_api_key ? "••••••••" : "",
    agentId: row.agent_id,
    concurrencyLimit: Number(row.concurrency_limit || 0),
    billingLabel: row.billing_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function agentConfigView(row, includeSecrets = false) {
  return {
    id: row.id,
    name: row.name,
    agentApiUrl: row.agent_api_url,
    agentApiKeyConfigured: Boolean(row.agent_api_key),
    agentApiKey: includeSecrets ? row.agent_api_key : row.agent_api_key ? "••••••••" : "",
    agentId: row.agent_id,
    concurrencyLimit: Number(row.concurrency_limit || 0),
    billingLabel: row.billing_label,
    isDefault: Boolean(row.default_for_person),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function resolveBinding(db, accountRow, includeSecrets) {
  const catalog = resolveCatalogBinding(db, accountRow, includeSecrets);
  if (catalog?.agentApiUrl && catalog?.agentApiKeyConfigured) return catalog;
  const candidates = [
    accountRow.person_id ? ["person", accountRow.person_id] : null,
    !accountRow.person_id && accountRow.workspace_channel_id ? ["assistant", accountRow.workspace_channel_id] : null,
    accountRow.workspace_id ? ["workspace", accountRow.workspace_id] : null,
    ["platform", "default"]
  ].filter(Boolean);
  for (const [scopeType, scopeId] of candidates) {
    const row = db.prepare("SELECT * FROM agent_bindings WHERE scope_type = ? AND scope_id = ? AND enabled = 1").get(scopeType, scopeId);
    if (row?.agent_api_url && row?.agent_api_key) return { ...bindingView(row, includeSecrets), inheritedFrom: scopeType };
  }
  if (accountRow.agent_api_url && accountRow.agent_api_key) {
    return {
      id: `legacy-${accountRow.id}`,
      scopeType: "legacy-account",
      scopeId: accountRow.id,
      inheritedFrom: "legacy-account",
      name: "兼容账号配置",
      enabled: true,
      agentApiUrl: accountRow.agent_api_url,
      agentApiKeyConfigured: true,
      agentApiKey: includeSecrets ? accountRow.agent_api_key : "••••••••",
      agentId: accountRow.agent_id,
      concurrencyLimit: 0,
      billingLabel: ""
    };
  }
  return null;
}

function resolveCatalogBinding(db, accountRow, includeSecrets) {
  let row = null;
  let inheritedFrom = "";
  if (accountRow.person_id) {
    row = db.prepare(`SELECT config.* FROM people person JOIN agent_configs config ON config.id = person.agent_config_id WHERE person.id = ?`).get(accountRow.person_id);
    inheritedFrom = row ? "person" : "platform-default";
    if (!row) row = db.prepare("SELECT * FROM agent_configs WHERE default_for_person = 1 LIMIT 1").get();
  } else if (accountRow.workspace_channel_id) {
    row = db.prepare(`SELECT config.* FROM workspace_channels channel JOIN agent_configs config ON config.id = channel.assistant_agent_config_id WHERE channel.id = ?`).get(accountRow.workspace_channel_id);
    inheritedFrom = row ? "assistant" : "platform-default";
    if (!row) row = db.prepare("SELECT * FROM agent_configs WHERE default_for_person = 1 LIMIT 1").get();
  }
  return row ? { ...agentConfigView(row, includeSecrets), scopeType: "agent-config", scopeId: row.id, enabled: true, inheritedFrom } : null;
}

function channelEndpoints(accountId, provider, publicSlug, { deploymentId = "", assistantAccountId = "", preview = false } = {}) {
  if (preview) {
    return {
      publicPage: `/channels/${publicSlug}`,
      publicMessages: `/api/admin/deployments/${deploymentId}/preview/messages`,
      publicMedia: `/api/admin/deployments/${deploymentId}/preview/media`,
      publicOutbox: `/api/admin/deployments/${deploymentId}/preview/conversations/{conversationId}/outbox?after=0`,
      assistantMessages: assistantAccountId ? `/api/admin/deployments/${deploymentId}/preview/assistant/messages` : "",
      assistantOutbox: assistantAccountId ? `/api/admin/deployments/${deploymentId}/preview/assistant/conversations/{conversationId}/outbox?after=0` : "",
      inbound: `/api/channels/${provider}/${accountId}/events`,
      outbox: `/api/channels/${provider}/${accountId}/conversations/{conversationId}/outbox?after=0`,
      receipts: `/api/channels/${provider}/${accountId}/receipts`
    };
  }
  return {
    publicPage: `/channels/${publicSlug}`,
    publicMessages: `/api/public/channels/${publicSlug}/messages`,
    publicMedia: `/api/public/channels/${publicSlug}/media`,
    publicOutbox: `/api/public/channels/${publicSlug}/conversations/{conversationId}/outbox?after=0`,
    assistantMessages: assistantAccountId ? `/api/public/channels/${publicSlug}/assistant/messages` : "",
    assistantOutbox: assistantAccountId ? `/api/public/channels/${publicSlug}/assistant/conversations/{conversationId}/outbox?after=0` : "",
    inbound: `/api/channels/${provider}/${accountId}/events`,
    outbox: `/api/channels/${provider}/${accountId}/conversations/{conversationId}/outbox?after=0`,
    receipts: `/api/channels/${provider}/${accountId}/receipts`
  };
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

function flowSessionView(row) {
  if (!row) return null;
  return {
    conversationId: Number(row.conversation_id),
    accountId: row.account_id,
    currentNodeId: row.current_node_id,
    collectedData: json(row.collected_data_json),
    status: row.status,
    enteredAt: row.entered_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function ruleTagView(row) {
  return {
    id: `${row.group_id}:${row.tag_id}`,
    conversationId: Number(row.conversation_id),
    groupId: row.group_id,
    groupName: row.group_name,
    tagId: row.tag_id,
    tagName: row.tag_name,
    name: row.tag_name,
    reason: row.reason || "",
    source: row.source,
    createdAt: row.created_at
  };
}

function activationTaskView(row) {
  return {
    id: Number(row.id),
    conversationId: Number(row.conversation_id),
    accountId: row.account_id,
    sourceType: row.source_type,
    sourceKey: row.source_key,
    messageIndex: Number(row.message_index),
    sequenceNo: Number(row.sequence_no),
    content: row.content,
    polishByAgent: Boolean(row.polish_by_agent),
    dueAt: row.due_at
  };
}

function cleanText(value, fallback = "", max = 1000) {
  if (value === undefined || value === null) return fallback;
  return String(value).trim().slice(0, max);
}

function requiredText(value, label, max) {
  const result = cleanText(value, "", max);
  if (!result) throw new TypeError(`${label} is required`);
  return result;
}

function identifier(value) {
  const result = cleanText(value, "", 80);
  if (!/^[a-z][a-z0-9-]{2,79}$/.test(result)) throw new TypeError("Invalid identifier");
  return result;
}

function color(value) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#2a30d8";
}

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeInteger(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : 0;
}

function validateTagSchema(schema) {
  const groupIds = new Set();
  for (const group of schema.groups) {
    if (!group.id || !group.name || groupIds.has(group.id)) throw new TypeError("Tag group ids must be unique and non-empty");
    groupIds.add(group.id);
    const tagIds = new Set();
    for (const tag of group.tags) {
      if (!tag.id || !tag.name || tagIds.has(tag.id)) throw new TypeError(`Tag ids in '${group.id}' must be unique and non-empty`);
      tagIds.add(tag.id);
    }
  }
}
