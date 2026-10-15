import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { once } from "node:events";
import { createApp } from "../src/app.js";

async function fixture(fetchImpl = globalThis.fetch) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-agent-service-"));
  const context = createApp({ databasePath: path.join(directory, "test.sqlite"), agentTimeoutMs: 5000 }, { fetchImpl });
  const server = context.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    ...context,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      context.db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

async function jsonRequest(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const data = response.status === 204 ? null : await response.json();
  return { response, data };
}

function inbound({ eventId = "event-1", messageId = "message-1", text = "你好" } = {}) {
  return {
    event_id: eventId,
    occurred_at: "2026-10-15T08:00:00.000Z",
    conversation: { id: "session-1", user_id: "visitor-1", display_name: "测试访客" },
    message: { id: messageId, type: "text", text }
  };
}

test("website adapter creates one conversation and one outbound delivery for an idempotent event", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const first = await jsonRequest(app.baseUrl, "/api/channels/website/website-default/events", { method: "POST", body: inbound() });
  assert.equal(first.response.status, 202);
  assert.equal(first.data.items[0].handledBy, "agent");

  const duplicate = await jsonRequest(app.baseUrl, "/api/channels/website/website-default/events", { method: "POST", body: inbound() });
  assert.equal(duplicate.data.items[0].duplicate, true);

  const conversations = await jsonRequest(app.baseUrl, "/api/accounts/website-default/conversations");
  assert.equal(conversations.data.items.length, 1);
  assert.equal(conversations.data.items[0].state, "engaged");

  const outbox = await jsonRequest(app.baseUrl, "/api/channels/website/website-default/conversations/session-1/outbox?after=0");
  assert.equal(outbox.data.items.length, 1);
  assert.equal(outbox.data.items[0].content, "您的消息已收到，我们会尽快为您处理。");

  const messages = await jsonRequest(app.baseUrl, `/api/conversations/${conversations.data.items[0].id}/messages`);
  assert.deepEqual(messages.data.items.map((item) => item.direction), ["inbound", "outbound"]);
});

test("human handoff prevents agent invocation and automatic delivery", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  await jsonRequest(app.baseUrl, "/api/channels/miniapp/miniapp-default/events", { method: "POST", body: inbound() });
  const conversations = await jsonRequest(app.baseUrl, "/api/accounts/miniapp-default/conversations");
  const id = conversations.data.items[0].id;
  const handoff = await jsonRequest(app.baseUrl, `/api/conversations/${id}/mode`, { method: "PUT", body: { mode: "human", operator: "test" } });
  assert.equal(handoff.data.mode, "human");

  const next = await jsonRequest(app.baseUrl, "/api/channels/miniapp/miniapp-default/events", { method: "POST", body: inbound({ eventId: "event-2", messageId: "message-2", text: "还在吗" }) });
  assert.equal(next.data.items[0].handledBy, "human");
  const outbox = await jsonRequest(app.baseUrl, "/api/channels/miniapp/miniapp-default/conversations/session-1/outbox?after=0");
  assert.equal(outbox.data.items.length, 1);

  const sent = await jsonRequest(app.baseUrl, `/api/conversations/${id}/messages`, { method: "POST", body: { content: "人工客服在的" } });
  assert.equal(sent.response.status, 201);
  assert.equal(sent.data.senderType, "human");
});

test("Agent Gateway receives channel-neutral identity and applies validated decisions", async (t) => {
  let captured;
  const agentFetch = async (_url, options) => {
    captured = { headers: options.headers, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      reply: "可以，我来为您安排产品顾问。",
      state: "qualified",
      tags: ["高意向"],
      attention: { title: "安排产品顾问", detail: "客户希望进一步了解产品" },
      handoff: true
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const app = await fixture(agentFetch);
  t.after(() => app.close());

  await jsonRequest(app.baseUrl, "/api/accounts/website-default", {
    method: "PUT",
    body: { agentApiUrl: "https://agent.example.test/openapi/chat", agentApiKey: "secret", agentId: "sales-agent" }
  });
  const received = await jsonRequest(app.baseUrl, "/api/channels/website/website-default/events", { method: "POST", body: inbound({ text: "请安排产品顾问联系我" }) });
  assert.equal(received.data.items[0].handledBy, "agent");
  assert.equal(captured.body.external_user_id, "website:website-default:visitor-1");
  assert.equal(captured.body.external_session_id, "website:website-default:session-1");
  assert.equal(captured.headers["Idempotency-Key"], `agent:website-default:${received.data.items[0].messageId}`);

  const conversations = await jsonRequest(app.baseUrl, "/api/accounts/website-default/conversations");
  assert.equal(conversations.data.items[0].state, "qualified");
  assert.equal(conversations.data.items[0].mode, "human");
  assert.deepEqual(conversations.data.items[0].tags.map((tag) => tag.name), ["高意向"]);
  const alerts = await jsonRequest(app.baseUrl, "/api/accounts/website-default/alerts");
  assert.equal(alerts.data.items[0].title, "安排产品顾问");
});
