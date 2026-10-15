import express from "express";
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

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

export function createApp(config, { database = null, fetchImpl = globalThis.fetch } = {}) {
  const db = database || openDatabase(config.databasePath);
  const store = new Store(db);
  const registry = createChannelRegistry({
    publish: async (message) => store.publishOutbox(message)
  });
  const gateway = new AgentGateway({ timeoutMs: config.agentTimeoutMs, fetchImpl });
  const delivery = new DeliveryService({ store, registry, maxAttempts: config.deliveryMaxAttempts });
  const messages = new MessageService({ store, registry, gateway, delivery });
  const activation = new ActivationService({ store, gateway, delivery });
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    req.requestId = req.header("x-request-id") || randomUUID();
    res.setHeader("x-request-id", req.requestId);
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true, service: "dclaw-agent-service", adapters: registry.list(), time: new Date().toISOString() }));
  app.get("/api/adapters", (_req, res) => res.json({ items: registry.list() }));

  app.get("/api/accounts", (_req, res) => res.json({ items: store.listAccounts() }));
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
    if (!content) return res.status(400).json({ error: "Message content is required" });
    const result = await delivery.send({ account, conversation, content, senderType: "human", metadata: { operator: String(req.body?.operator || "console") } });
    res.status(201).json(result);
  }));

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

  app.use("/", express.static(path.resolve(sourceDir, "../public"), { extensions: ["html"] }));
  app.get("/", (_req, res) => res.redirect("/console/"));
  app.use((req, res) => res.status(404).json({ error: "Not found", requestId: req.requestId }));
  app.use((error, req, res, _next) => {
    console.error(`[${req.requestId}]`, error);
    res.status(Number(error.status) || (error instanceof TypeError ? 400 : 500)).json({ error: String(error.message || error), requestId: req.requestId });
  });

  return { app, db, store, registry, services: { gateway, delivery, messages, activation } };
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
