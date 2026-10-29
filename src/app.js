import express from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./database.js";
import { Store } from "./repositories/store.js";
import { createChannelRegistry } from "./channels/index.js";
import { AgentGateway } from "./services/agent-gateway.js";
import { DeliveryService } from "./services/delivery-service.js";
import { MessageService } from "./services/message-service.js";
import { ActivationService } from "./services/activation-service.js";
import { SpeechTranscriber } from "./services/speech-transcriber.js";
import { CredentialVault } from "./services/credential-vault.js";
import { WorkspaceMiniappService } from "./services/workspace-miniapp-service.js";
import { listChannelTypes } from "./channel-catalog.js";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

export function createApp(config, { database = null, fetchImpl = globalThis.fetch, speechTranscriber = null } = {}) {
  const db = database || openDatabase(config.databasePath);
  const store = new Store(db);
  const registry = createChannelRegistry({
    publish: async (message) => store.publishOutbox(message)
  });
  const gateway = new AgentGateway({ timeoutMs: config.agentTimeoutMs, fetchImpl });
  const delivery = new DeliveryService({ store, registry, maxAttempts: config.deliveryMaxAttempts });
  const messages = new MessageService({ store, registry, gateway, delivery });
  const activation = new ActivationService({ store, gateway, delivery });
  const transcriber = speechTranscriber || new SpeechTranscriber({
    apiUrl: config.speechApiUrl,
    apiKey: config.speechApiKey,
    model: config.speechModel,
    language: config.speechLanguage,
    timeoutMs: config.speechTimeoutMs,
    fetchImpl
  });
  const credentialVault = new CredentialVault(config.credentialEncryptionKey);
  const workspaceMiniapps = new WorkspaceMiniappService({ store, vault: credentialVault, fetchImpl, sessionTtlDays: config.wechatSessionTtlDays });
  const app = express();
  const publicMediaDir = path.resolve(path.dirname(config.databasePath), "public-media");
  fs.mkdirSync(publicMediaDir, { recursive: true });

  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    req.requestId = req.header("x-request-id") || randomUUID();
    res.setHeader("x-request-id", req.requestId);
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true, service: "dclaw-agent-service", adapters: registry.list(), time: new Date().toISOString() }));
  app.get("/api/adapters", (_req, res) => res.json({ items: registry.list() }));

  app.post("/api/public/wechat/login", asyncHandler(async (req, res) => {
    res.json(await workspaceMiniapps.login({
      publicSlug: String(req.body?.publicSlug || ""),
      deploymentId: String(req.body?.deploymentId || ""),
      code: req.body?.code
    }));
  }));
  app.put("/api/public/wechat/profile", (req, res) => {
    const avatarUrl = String(req.body?.avatarUrl || "").trim();
    if (avatarUrl && !/^https?:\/\//i.test(avatarUrl) && !avatarUrl.startsWith("/media/")) throw new TypeError("微信头像地址无效");
    res.json({ profile: workspaceMiniapps.saveProfile(req.header("authorization"), req.body || {}) });
  });
  app.get("/api/public/miniapps/:appId", (req, res) => respondFound(res, store.publicMiniappHome(req.params.appId)));

  app.get("/api/admin/channel-types", (_req, res) => res.json({ items: listChannelTypes() }));
  app.get("/api/admin/workspaces", (_req, res) => res.json({ items: store.listWorkspaces() }));
  app.post("/api/admin/workspaces", (req, res) => res.status(201).json(store.createWorkspace(req.body || {})));
  app.get("/api/admin/workspaces/:workspaceId", (req, res) => respondFound(res, store.getWorkspace(req.params.workspaceId)));
  app.put("/api/admin/workspaces/:workspaceId", (req, res) => respondFound(res, store.updateWorkspace(req.params.workspaceId, req.body || {})));
  app.get("/api/admin/workspaces/:workspaceId/people", (req, res) => res.json({ items: store.listPeople(req.params.workspaceId) }));
  app.post("/api/admin/workspaces/:workspaceId/people", (req, res) => res.status(201).json(store.createPerson(req.params.workspaceId, req.body || {})));
  app.put("/api/admin/people/:personId", (req, res) => respondFound(res, store.updatePerson(req.params.personId, req.body || {})));
  app.get("/api/admin/workspaces/:workspaceId/channels", (req, res) => res.json({ items: store.listWorkspaceChannels(req.params.workspaceId) }));
  app.get("/api/admin/workspaces/:workspaceId/miniapp", (req, res) => res.json({ config: workspaceMiniapps.get(req.params.workspaceId) }));
  app.put("/api/admin/workspaces/:workspaceId/miniapp", (req, res) => respondFound(res, workspaceMiniapps.save(req.params.workspaceId, req.body || {})));
  app.post("/api/admin/workspaces/:workspaceId/miniapp/verify", asyncHandler(async (req, res) => respondFound(res, await workspaceMiniapps.verify(req.params.workspaceId))));
  app.post("/api/admin/workspaces/:workspaceId/channels", (req, res) => {
    registry.get(req.body?.provider);
    res.status(201).json(store.createWorkspaceChannel(req.params.workspaceId, req.body || {}));
  });
  app.put("/api/admin/channels/:channelId", (req, res) => respondFound(res, store.updateWorkspaceChannel(req.params.channelId, req.body || {})));
  app.post("/api/admin/channels/:channelId/publish", (req, res) => respondFound(res, store.publishWorkspaceChannel(req.params.channelId)));
  app.get("/api/admin/workspaces/:workspaceId/deployments", (req, res) => res.json({ items: store.listDeployments(req.params.workspaceId) }));
  app.post("/api/admin/workspaces/:workspaceId/deployments", (req, res) => res.status(201).json(store.createDeployment(req.params.workspaceId, req.body || {})));
  app.put("/api/admin/deployments/:deploymentId", (req, res) => respondFound(res, store.updateDeployment(req.params.deploymentId, req.body || {})));
  app.get("/api/admin/deployments/:deploymentId/preview", (req, res) => respondFound(res, store.channelPreview(req.params.deploymentId, { published: req.query.published === "1" })));
  app.get("/api/admin/channels/:channelId/preview", (req, res) => respondFound(res, store.workspaceChannelPreview(req.params.channelId)));
  app.get("/api/admin/agents", (req, res) => res.json({ items: store.listAgentConfigs(), defaults: store.agentDefaults() }));
  app.post("/api/admin/agents", (req, res) => res.status(201).json(store.createAgentConfig(req.body || {})));
  app.put("/api/admin/agents/:agentConfigId", (req, res) => respondFound(res, store.updateAgentConfig(req.params.agentConfigId, req.body || {})));
  app.delete("/api/admin/agents/:agentConfigId", (req, res) => {
    if (!store.deleteAgentConfig(req.params.agentConfigId)) return res.status(404).json({ error: "Agent config not found" });
    res.status(204).end();
  });
  app.put("/api/admin/agent-defaults", (req, res) => res.json({ defaults: store.saveAgentDefaults(req.body || {}) }));
  app.post("/api/admin/deployments/:deploymentId/preview/media", express.raw({ type: () => true, limit: "12mb" }), asyncHandler(async (req, res) => {
    const preview = store.channelPreview(req.params.deploymentId);
    if (!preview) return res.status(404).json({ error: "Deployment not found" });
    await savePublicMedia({ req, res, publicMediaDir });
  }));
  app.post("/api/admin/deployments/:deploymentId/preview/messages", asyncHandler(async (req, res) => {
    const preview = store.channelPreview(req.params.deploymentId);
    if (!preview) return res.status(404).json({ error: "Deployment not found" });
    await receivePageMessage({ req, res, store, messages, transcriber, publicMediaDir, accountId: preview.deployment.accountId, provider: preview.channelType, surface: "admin-preview", displayName: "后台预览访客" });
  }));
  app.get("/api/admin/deployments/:deploymentId/preview/conversations/:conversationId/outbox", (req, res) => {
    const preview = store.channelPreview(req.params.deploymentId);
    if (!preview) return res.status(404).json({ error: "Deployment not found" });
    res.json({ items: store.pollOutbox(preview.deployment.accountId, publicIdentifier(req.params.conversationId, "conversationId"), clampInt(req.query.after, 0, Number.MAX_SAFE_INTEGER, 0)) });
  });
  app.post("/api/admin/deployments/:deploymentId/preview/assistant/messages", asyncHandler(async (req, res) => {
    const preview = store.channelPreview(req.params.deploymentId);
    const accountId = preview?.channel?.assistantAccountId;
    if (!preview || !accountId) return res.status(404).json({ error: "Company assistant not found" });
    await receivePageMessage({ req, res, store, messages, transcriber, publicMediaDir, accountId, provider: preview.channelType, surface: "admin-preview-assistant", displayName: "后台助手预览访客" });
  }));
  app.get("/api/admin/deployments/:deploymentId/preview/assistant/conversations/:conversationId/outbox", (req, res) => {
    const preview = store.channelPreview(req.params.deploymentId);
    const accountId = preview?.channel?.assistantAccountId;
    if (!preview || !accountId) return res.status(404).json({ error: "Company assistant not found" });
    res.json({ items: store.pollOutbox(accountId, publicIdentifier(req.params.conversationId, "conversationId"), clampInt(req.query.after, 0, Number.MAX_SAFE_INTEGER, 0)) });
  });
  app.get("/api/admin/agent-bindings/:scopeType/:scopeId", (req, res) => res.json({ binding: store.getAgentBinding(req.params.scopeType, req.params.scopeId) }));
  app.put("/api/admin/agent-bindings/:scopeType/:scopeId", (req, res) => res.json({ binding: store.saveAgentBinding(req.params.scopeType, req.params.scopeId, req.body || {}) }));
  app.post("/api/admin/media", express.raw({ type: () => true, limit: "30mb" }), asyncHandler(async (req, res) => {
    const mimeType = String(req.header("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    const mediaType = adminAssetType(mimeType);
    if (!mediaType || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ error: "仅支持 PNG、JPEG、WebP 图片或 MP4、WebM 视频" });
    if (req.body.length > mediaType.maxBytes) return res.status(413).json({ error: `${mediaType.label}不能超过 ${mediaType.maxBytes / 1024 / 1024}MB` });
    const filename = `${randomUUID()}.${mediaType.extension}`;
    await fs.promises.writeFile(path.join(publicMediaDir, filename), req.body, { flag: "wx" });
    const suppliedName = decodeHeaderValue(req.header("x-file-name")).replace(/[\r\n]/g, "").slice(0, 160);
    res.status(201).json({ asset: { type: mediaType.type, url: `/media/${filename}`, name: suppliedName || `${mediaType.type}.${mediaType.extension}`, mimeType } });
  }));
  app.get("/api/public/channels/:publicSlug", (req, res) => respondFound(res, store.publicChannel(req.params.publicSlug)));
  app.post("/api/public/channels/:publicSlug/assistant/messages", asyncHandler(async (req, res) => {
    const channel = store.publicChannel(req.params.publicSlug);
    const accountId = channel ? store.getWorkspaceChannel(channel.channel.id, { includeSecrets: true })?.assistantAccountId : null;
    if (!channel || !accountId) return res.status(404).json({ error: "Company assistant not found" });
    await receivePageMessage({ req, res, store, messages, transcriber, publicMediaDir, accountId, provider: channel.channelType, surface: "public-company-assistant", displayName: "公司名片访客" });
  }));
  app.get("/api/public/channels/:publicSlug/assistant/conversations/:conversationId/outbox", (req, res) => {
    const channel = store.publicChannel(req.params.publicSlug);
    const accountId = channel ? store.getWorkspaceChannel(channel.channel.id, { includeSecrets: true })?.assistantAccountId : null;
    if (!channel || !accountId) return res.status(404).json({ error: "Company assistant not found" });
    res.json({ items: store.pollOutbox(accountId, publicIdentifier(req.params.conversationId, "conversationId"), clampInt(req.query.after, 0, Number.MAX_SAFE_INTEGER, 0)) });
  });
  app.post("/api/public/channels/:publicSlug/media", express.raw({ type: () => true, limit: "12mb" }), asyncHandler(async (req, res) => {
    const channel = store.publicChannel(req.params.publicSlug);
    if (!channel) return res.status(404).json({ error: "Channel not found" });
    await savePublicMedia({ req, res, publicMediaDir });
  }));
  app.post("/api/public/channels/:publicSlug/messages", asyncHandler(async (req, res) => {
    const channel = store.publicChannel(req.params.publicSlug);
    if (!channel) return res.status(404).json({ error: "Channel not found" });
    const conversationId = publicIdentifier(req.body?.conversationId, "conversationId");
    const userId = publicIdentifier(req.body?.userId, "userId");
    const messageId = publicIdentifier(req.body?.message?.id, "message.id");
    const text = String(req.body?.message?.text || "").trim().slice(0, 20_000);
    const messageType = ["text", "audio", "image", "file"].includes(req.body?.message?.type) ? req.body.message.type : "text";
    const attachments = publicAttachments(req.body?.message?.attachments, req);
    if (!text && !attachments.length) throw new TypeError("Message text or attachment is required");
    const account = store.getAccount(channel.deployment.accountId, { includeSecrets: true });
    const transcription = await transcribeInboundAudio({ transcriber, messageType, attachments, req, publicMediaDir });
    const items = await messages.receive({
      provider: channel.channelType,
      accountId: channel.deployment.accountId,
      secret: account.webhookSecret,
      payload: {
        event_id: messageId,
        occurred_at: new Date().toISOString(),
        conversation: { id: conversationId, user_id: userId, display_name: String(req.body?.displayName || "名片访客").slice(0, 120) },
        message: { id: messageId, type: messageType, text: transcription || text, attachments },
        metadata: { publicSlug: req.params.publicSlug, surface: "public-page", transcription: transcription || undefined }
      }
    });
    res.status(202).json({ items });
  }));
  app.get("/api/public/channels/:publicSlug/conversations/:conversationId/outbox", (req, res) => {
    const channel = store.publicChannel(req.params.publicSlug);
    if (!channel) return res.status(404).json({ error: "Channel not found" });
    const conversationId = publicIdentifier(req.params.conversationId, "conversationId");
    res.json({ items: store.pollOutbox(channel.deployment.accountId, conversationId, clampInt(req.query.after, 0, Number.MAX_SAFE_INTEGER, 0)) });
  });

  app.get("/api/accounts", (req, res) => res.json({ items: store.listAccounts({ workspaceId: String(req.query.workspace || "") }) }));
  app.post("/api/accounts", (req, res) => {
    registry.get(req.body?.provider);
    res.status(201).json(store.createAccount(req.body || {}));
  });
  app.get("/api/accounts/:accountId", (req, res) => respondFound(res, store.getAccount(req.params.accountId)));
  app.put("/api/accounts/:accountId", (req, res) => respondFound(res, store.updateAccount(req.params.accountId, req.body || {})));
  app.get("/api/accounts/:accountId/dashboard", (req, res) => res.json(store.dashboard(req.params.accountId)));
  app.get("/api/accounts/:accountId/state-machine", (req, res) => res.json(store.getStateMachine(req.params.accountId)));
  app.put("/api/accounts/:accountId/state-machine", (req, res) => res.json(store.saveStateMachine(req.params.accountId, req.body || {})));
  app.get("/api/flow-machines/:accountId", (req, res) => res.json({ ok: true, machine: store.getFlowMachine(req.params.accountId, { useDefault: req.query.default === "1" }) }));
  app.put("/api/flow-machines/:accountId", (req, res) => res.json({ ok: true, machine: store.saveFlowMachine(req.params.accountId, req.body || {}) }));
  app.get("/api/tag-schemas/:accountId", (req, res) => res.json({ ok: true, schema: store.getTagSchema(req.params.accountId).config }));
  app.put("/api/tag-schemas/:accountId", (req, res) => res.json({ ok: true, schema: store.saveTagSchema(req.params.accountId, req.body?.schema || req.body || {}).config }));
  app.get("/api/accounts/:accountId/tags", (req, res) => res.json({ items: store.listTags(req.params.accountId), schema: store.getTagSchema(req.params.accountId).config }));
  app.get("/api/accounts/:accountId/alerts", (req, res) => res.json({ items: store.listAlerts(req.params.accountId, String(req.query.status ?? "open")) }));
  app.get("/api/accounts/:accountId/audit", (req, res) => res.json({ items: store.listAudit(req.params.accountId, clampInt(req.query.limit, 1, 500, 200)) }));

  app.get("/api/accounts/:accountId/conversations", (req, res) => res.json({ items: store.listConversations(req.params.accountId, {
    query: String(req.query.query || "").slice(0, 120), state: String(req.query.state || ""), mode: String(req.query.mode || "")
  }) }));
  app.get("/api/conversations/:conversationId", (req, res) => respondFound(res, store.getConversation(numberId(req.params.conversationId))));
  app.get("/api/conversations/:conversationId/messages", (req, res) => {
    const id = numberId(req.params.conversationId);
    store.markRead(id);
    res.json({ items: store.listMessages(id) });
  });
  app.get("/api/conversations/:conversationId/flow-events", (req, res) => res.json({ items: store.listFlowEvents(numberId(req.params.conversationId)) }));
  app.put("/api/conversations/:conversationId/mode", (req, res) => respondFound(res, store.setConversationMode(numberId(req.params.conversationId), req.body?.mode, { operator: String(req.body?.operator || "console"), note: String(req.body?.note || "") })));
  app.put("/api/conversations/:conversationId/state", (req, res) => respondFound(res, store.setConversationState(numberId(req.params.conversationId), String(req.body?.state || ""), "manual")));
  app.post("/api/conversations/:conversationId/tags", (req, res) => {
    const id = numberId(req.params.conversationId);
    if (req.body?.decision) return res.json(store.applyTagDecision(id, req.body.decision, { source: "manual" }));
    return res.json({ items: store.assignTags(id, req.body?.tags, { source: "manual" }) });
  });
  app.post("/api/conversations/:conversationId/messages", asyncHandler(async (req, res) => {
    const conversation = store.getConversation(numberId(req.params.conversationId));
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    const account = store.getAccount(conversation.accountId, { includeSecrets: true });
    const content = String(req.body?.content || "").trim();
    const attachments = consoleAttachments(req.body?.attachments, req);
    if (!content && !attachments.length) return res.status(400).json({ error: "Message content or attachment is required" });
    const result = await delivery.send({ account, conversation, content, attachments, senderType: "human", metadata: { operator: String(req.body?.operator || "console") } });
    res.status(201).json(result);
  }));
  app.post("/api/conversations/:conversationId/reset", (req, res) => {
    const reset = store.resetConversation(numberId(req.params.conversationId));
    return reset ? res.status(204).end() : res.status(404).json({ error: "Conversation not found" });
  });

  app.put("/api/alerts/:alertId/resolve", (req, res) => {
    store.resolveAlert(numberId(req.params.alertId));
    res.status(204).end();
  });

  app.post("/api/accounts/:accountId/activation", asyncHandler(async (req, res) => {
    const account = store.getAccount(req.params.accountId, { includeSecrets: true });
    if (!account) return res.status(404).json({ error: "Channel account not found" });
    const content = String(req.body?.content || "").trim();
    const ids = [...new Set((Array.isArray(req.body?.conversationIds) ? req.body.conversationIds : []).map(Number).filter(Number.isSafeInteger))];
    if (!content || !ids.length) return res.status(400).json({ error: "content and conversationIds are required" });
    const results = [];
    for (const id of ids) {
      const conversation = store.getConversation(id);
      if (!conversation || conversation.accountId !== account.id) continue;
      try {
        const message = await delivery.send({ account, conversation, content, senderType: "human", metadata: { activation: true } });
        results.push({ conversationId: id, ok: true, messageId: message.id });
      } catch (error) {
        results.push({ conversationId: id, ok: false, error: String(error.message || error) });
      }
    }
    res.status(202).json({ items: results });
  }));

  app.post("/api/channels/:provider/:accountId/events", asyncHandler(async (req, res) => {
    const results = await messages.receive({
      provider: req.params.provider,
      accountId: req.params.accountId,
      payload: req.body,
      secret: req.header("x-channel-secret") || ""
    });
    res.status(202).json({ items: results });
  }));

  app.get("/api/channels/:provider/:accountId/conversations/:externalConversationId/outbox", (req, res) => {
    const account = store.getAccount(req.params.accountId);
    if (!account || account.provider !== req.params.provider) return res.status(404).json({ error: "Channel account not found" });
    res.json({ items: store.pollOutbox(req.params.accountId, req.params.externalConversationId, clampInt(req.query.after, 0, Number.MAX_SAFE_INTEGER, 0)) });
  });

  app.post("/api/channels/:provider/:accountId/receipts", (req, res) => {
    const account = store.getAccount(req.params.accountId);
    if (!account || account.provider !== req.params.provider) return res.status(404).json({ error: "Channel account not found" });
    const updated = store.acknowledgeDelivery(account.id, String(req.body?.providerMessageId || ""), String(req.body?.status || ""));
    res.status(updated ? 204 : 404).end();
  });

  app.use("/media", express.static(publicMediaDir, { fallthrough: false, immutable: true, maxAge: "1y" }));
  app.get("/channels/:publicSlug", (_req, res) => res.sendFile(path.resolve(sourceDir, "../public/channel-preview/index.html")));
  app.use("/", express.static(path.resolve(sourceDir, "../public"), { extensions: ["html"] }));
  app.get("/", (_req, res) => res.redirect("/console/"));
  app.use((req, res) => res.status(404).json({ error: "Not found", requestId: req.requestId }));
  app.use((error, req, res, _next) => {
    console.error(`[${req.requestId}]`, error);
    res.status(Number(error.status) || (error instanceof TypeError ? 400 : 500)).json({ error: String(error.message || error), requestId: req.requestId });
  });

  return { app, db, store, registry, services: { gateway, delivery, messages, activation, transcriber, credentialVault, workspaceMiniapps } };
}

async function receivePageMessage({ req, res, store, messages, transcriber, publicMediaDir, accountId, provider, surface, displayName }) {
  const account = store.getAccount(accountId, { includeSecrets: true });
  if (!account) return res.status(404).json({ error: "Channel account not found" });
  const conversationId = publicIdentifier(req.body?.conversationId, "conversationId");
  const userId = publicIdentifier(req.body?.userId, "userId");
  const messageId = publicIdentifier(req.body?.message?.id, "message.id");
  const text = String(req.body?.message?.text || "").trim().slice(0, 20_000);
  const messageType = ["text", "audio", "image", "file"].includes(req.body?.message?.type) ? req.body.message.type : "text";
  const attachments = publicAttachments(req.body?.message?.attachments, req);
  if (!text && !attachments.length) throw new TypeError("Message text or attachment is required");
  const transcription = await transcribeInboundAudio({ transcriber, messageType, attachments, req, publicMediaDir });
  const items = await messages.receive({
    provider,
    accountId,
    secret: account.webhookSecret,
    forceAgent: String(surface || "").startsWith("admin-preview"),
    payload: {
      event_id: messageId,
      occurred_at: new Date().toISOString(),
      conversation: { id: conversationId, user_id: userId, display_name: String(req.body?.displayName || displayName).slice(0, 120) },
      message: { id: messageId, type: messageType, text: transcription || text, attachments },
      metadata: { surface, transcription: transcription || undefined }
    }
  });
  res.status(202).json({ items });
}

async function savePublicMedia({ req, res, publicMediaDir }) {
  const mimeType = String(req.header("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  const mediaType = publicMediaType(mimeType);
  if (!mediaType || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ error: "Unsupported or empty media" });
  const filename = `${randomUUID()}.${mediaType.extension}`;
  await fs.promises.writeFile(path.join(publicMediaDir, filename), req.body, { flag: "wx" });
  const suppliedName = decodeHeaderValue(req.header("x-file-name")).replace(/[\r\n]/g, "").slice(0, 160);
  res.status(201).json({ attachment: {
    type: mediaType.type,
    url: `${req.protocol}://${req.get("host")}/media/${filename}`,
    name: suppliedName || `${mediaType.type}.${mediaType.extension}`,
    mimeType
  } });
}

async function transcribeInboundAudio({ transcriber, messageType, attachments, req, publicMediaDir }) {
  if (messageType !== "audio" || !transcriber?.isConfigured?.()) return "";
  const attachment = attachments.find((item) => item.type === "audio");
  if (!attachment) return "";
  const ownOrigin = `${req.protocol}://${req.get("host")}`;
  const mediaUrl = new URL(attachment.url);
  if (mediaUrl.origin !== ownOrigin || !mediaUrl.pathname.startsWith("/media/")) throw new TypeError("Invalid audio attachment URL");
  const filename = decodeURIComponent(mediaUrl.pathname.slice("/media/".length));
  if (!/^[A-Za-z0-9-]+\.(?:webm|m4a|mp3|ogg)$/.test(filename)) throw new TypeError("Invalid audio attachment filename");
  const buffer = await fs.promises.readFile(path.join(publicMediaDir, filename));
  return transcriber.transcribe({
    buffer,
    mimeType: attachment.mimeType || "audio/mpeg",
    name: attachment.name || filename
  });
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function numberId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new TypeError("Invalid numeric id");
  return id;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function respondFound(res, value) {
  return value ? res.json(value) : res.status(404).json({ error: "Not found" });
}

function publicIdentifier(value, field) {
  const result = String(value || "");
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(result)) throw new TypeError(`Invalid ${field}`);
  return result;
}

function publicMediaType(mimeType) {
  return ({
    "audio/webm": { type: "audio", extension: "webm" },
    "audio/mp4": { type: "audio", extension: "m4a" },
    "audio/mpeg": { type: "audio", extension: "mp3" },
    "audio/ogg": { type: "audio", extension: "ogg" },
    "image/jpeg": { type: "image", extension: "jpg" },
    "image/png": { type: "image", extension: "png" },
    "image/webp": { type: "image", extension: "webp" },
    "application/pdf": { type: "file", extension: "pdf" }
  })[mimeType] || null;
}

function adminAssetType(mimeType) {
  return ({
    "video/mp4": { type: "video", extension: "mp4", maxBytes: 30 * 1024 * 1024, label: "视频" },
    "video/webm": { type: "video", extension: "webm", maxBytes: 30 * 1024 * 1024, label: "视频" },
    "image/jpeg": { type: "image", extension: "jpg", maxBytes: 10 * 1024 * 1024, label: "图片" },
    "image/png": { type: "image", extension: "png", maxBytes: 10 * 1024 * 1024, label: "图片" },
    "image/webp": { type: "image", extension: "webp", maxBytes: 10 * 1024 * 1024, label: "图片" }
  })[mimeType] || null;
}

function publicAttachments(value, req) {
  const ownOrigin = `${req.protocol}://${req.get("host")}/media/`;
  return (Array.isArray(value) ? value : []).slice(0, 5).map((item) => ({
    type: ["audio", "image", "file"].includes(item?.type) ? item.type : "file",
    url: String(item?.url || ""),
    name: String(item?.name || "").slice(0, 160),
    mimeType: String(item?.mimeType || "").slice(0, 120)
  })).filter((item) => item.url.startsWith(ownOrigin));
}

function consoleAttachments(value, req) {
  const origin = `${req.protocol}://${req.get("host")}`;
  return (Array.isArray(value) ? value : []).slice(0, 5).map((item) => {
    const suppliedUrl = String(item?.url || "");
    const url = suppliedUrl.startsWith("/media/") ? `${origin}${suppliedUrl}` : suppliedUrl;
    return {
      type: ["image", "video"].includes(item?.type) ? item.type : "file",
      url,
      name: String(item?.name || "").slice(0, 160),
      mimeType: String(item?.mimeType || "").slice(0, 120)
    };
  }).filter((item) => item.url.startsWith(`${origin}/media/`));
}

function decodeHeaderValue(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
}
