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
  assert.equal(conversations.data.items[0].state, "collect_basic_info");

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

test("console manual attachments are delivered and conversation reset clears its channel state", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  await jsonRequest(app.baseUrl, "/api/channels/website/website-default/events", { method: "POST", body: inbound() });
  const conversations = await jsonRequest(app.baseUrl, "/api/accounts/website-default/conversations");
  const id = conversations.data.items[0].id;
  const sent = await jsonRequest(app.baseUrl, `/api/conversations/${id}/messages`, {
    method: "POST",
    body: {
      content: "",
      attachments: [{ type: "image", url: `${app.baseUrl}/media/manual.png`, name: "manual.png", mimeType: "image/png" }]
    }
  });
  assert.equal(sent.response.status, 201);
  assert.equal(sent.data.messageType, "rich");
  assert.deepEqual(sent.data.metadata.attachments.map((item) => item.name), ["manual.png"]);

  const reset = await jsonRequest(app.baseUrl, `/api/conversations/${id}/reset`, { method: "POST" });
  assert.equal(reset.response.status, 204);
  const after = await jsonRequest(app.baseUrl, "/api/accounts/website-default/conversations");
  assert.equal(after.data.items.length, 0);
  const outbox = await jsonRequest(app.baseUrl, "/api/channels/website/website-default/conversations/session-1/outbox?after=0");
  assert.equal(outbox.data.items.length, 0);
});

test("Agent Gateway receives channel-neutral identity and applies validated decisions", async (t) => {
  let captured;
  const agentFetch = async (_url, options) => {
    captured = { headers: options.headers, body: JSON.parse(options.body) };
    const context = JSON.parse(captured.body.message.split("\n").at(-1));
    const evidence = { evidenceMessageId: String(context.currentMessage.id), evidenceText: context.currentMessage.text };
    return new Response(JSON.stringify({
      reply: "可以，我来为您安排产品人员。",
      flowDecision: { nodeCompleted: true, nextNodeId: "invite_next_step", collectedDataPatch: { "客户需求": "了解产品", "联系方式": "待确认" }, reason: "需求明确" },
      tagEvaluation: [
        { groupId: "intent_level", tagId: "potential", matched: true, reason: "客户主动咨询", ...evidence },
        { groupId: "intent_level", tagId: "high_intent", matched: true, reason: "客户要求安排人员", ...evidence },
        { groupId: "service_attention", tagId: "needs_follow_up", matched: false, reason: "无需延期跟进" },
        { groupId: "service_attention", tagId: "needs_human", matched: false, reason: "未明确要求人工" }
      ],
      tagDecision: { add: [{ groupId: "intent_level", tagId: "high_intent", reason: "客户要求安排人员", ...evidence }], remove: [] },
      attentionAlert: { title: "安排产品人员", detail: "客户希望进一步了解产品" },
      handoff: true
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const app = await fixture(agentFetch);
  t.after(() => app.close());

  await jsonRequest(app.baseUrl, "/api/accounts/website-default", {
    method: "PUT",
    body: { agentApiUrl: "https://agent.example.test/openapi/chat", agentApiKey: "secret", agentId: "sales-agent" }
  });
  const machine = await jsonRequest(app.baseUrl, "/api/flow-machines/website-default");
  await jsonRequest(app.baseUrl, "/api/flow-machines/website-default", { method: "PUT", body: { enabled: true, config: machine.data.machine.config } });
  const received = await jsonRequest(app.baseUrl, "/api/channels/website/website-default/events", { method: "POST", body: inbound({ text: "请安排产品人员联系我" }) });
  assert.equal(received.data.items[0].handledBy, "agent");
  assert.equal(captured.body.external_user_id, "website:website-default:visitor-1");
  assert.equal(captured.body.external_session_id, "website:website-default:session-1");
  assert.equal(captured.headers["Idempotency-Key"], `agent:website-default:${received.data.items[0].messageId}`);

  const conversations = await jsonRequest(app.baseUrl, "/api/accounts/website-default/conversations");
  assert.equal(conversations.data.items[0].state, "invite_next_step");
  assert.equal(conversations.data.items[0].mode, "human");
  assert.deepEqual(conversations.data.items[0].tags.map((tag) => tag.name), ["20261015", "高意向"]);
  const alerts = await jsonRequest(app.baseUrl, "/api/accounts/website-default/alerts");
  assert.deepEqual(new Set(alerts.data.items.map((item) => item.title)), new Set(["标签提醒：高意向", "安排产品人员"]));
});

test("Agent attachments reach the channel outbox and required=false does not create an alert", async (t) => {
  const agentFetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const payload = JSON.parse(request.message.split("\n").at(-1));
    const current = payload.flow.currentNode.id;
    return new Response(JSON.stringify({
      reply: "请扫码添加课程老师",
      attachments: [
        { type: "image", url: "https://example.test/teacher.png", name: "课程老师二维码.png" },
        { type: "single-choice", id: "contact-time", title: "选择联系时间", options: [{ label: "今天下午", value: "today-pm", description: "14:00-18:00" }, { label: "明天上午", value: "tomorrow-am" }], submitLabel: "提交回答" }
      ],
      sources: [{ type: "flow_node", name: current, reason: "节点配置" }],
      flowDecision: { currentNodeId: current, nodeCompleted: false, nextNodeId: current, collectedDataPatch: {}, confidence: 0.9, reason: "等待客户后续" },
      tagEvaluation: [],
      tagDecision: { add: [], remove: [] },
      attentionAlert: { required: false, reason: "", evidenceMessageId: "", evidenceText: "" }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const app = await fixture(agentFetch);
  t.after(() => app.close());
  await jsonRequest(app.baseUrl, "/api/accounts/miniapp-default", {
    method: "PUT",
    body: { agentApiUrl: "https://agent.example.test/openapi/chat", agentApiKey: "secret", agentId: "sales-agent" }
  });
  const machine = await jsonRequest(app.baseUrl, "/api/flow-machines/miniapp-default");
  await jsonRequest(app.baseUrl, "/api/flow-machines/miniapp-default", { method: "PUT", body: { enabled: true, config: machine.data.machine.config } });
  const schema = await jsonRequest(app.baseUrl, "/api/tag-schemas/miniapp-default");
  await jsonRequest(app.baseUrl, "/api/tag-schemas/miniapp-default", { method: "PUT", body: { schema: { ...schema.data.schema, dateTag: { enabled: false } , groups: [] } } });

  const received = await jsonRequest(app.baseUrl, "/api/channels/miniapp/miniapp-default/events", { method: "POST", body: inbound() });
  assert.equal(received.data.items[0].handledBy, "agent");
  const outbox = await jsonRequest(app.baseUrl, "/api/channels/miniapp/miniapp-default/conversations/session-1/outbox?after=0");
  assert.equal(outbox.data.items[0].messageType, "rich");
  assert.deepEqual(outbox.data.items[0].attachments, [
    { type: "image", url: "https://example.test/teacher.png", name: "课程老师二维码.png" },
    {
      type: "single-choice",
      id: "contact-time",
      title: "选择联系时间",
      subtitle: "",
      options: [
        { label: "今天下午", value: "today-pm", description: "14:00-18:00" },
        { label: "明天上午", value: "tomorrow-am", description: "" }
      ],
      submitLabel: "提交回答"
    }
  ]);
  const alerts = await jsonRequest(app.baseUrl, "/api/accounts/miniapp-default/alerts");
  assert.equal(alerts.data.items.length, 0);
});

test("Agent Gateway uses the completed SSE body instead of concatenating duplicate content events", async (t) => {
  const agentFetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const payload = JSON.parse(request.message.split("\n").at(-1));
    const current = payload.flow.currentNode.id;
    const reply = JSON.stringify({
      reply: "收到",
      flowDecision: { currentNodeId: current, nodeCompleted: false, nextNodeId: current, collectedDataPatch: {}, reason: "继续当前节点" },
      tagEvaluation: [],
      tagDecision: { add: [], remove: [] },
      attentionAlert: { required: false, reason: "", evidenceMessageId: "", evidenceText: "" }
    });
    const stream = [
      `data: ${JSON.stringify({ object: "content", status: "in_progress", delta: true, text: reply })}`,
      `data: ${JSON.stringify({ object: "content", status: "completed", delta: null, text: reply })}`,
      `data: ${JSON.stringify({ object: "response", status: "completed", output: [{ content: [{ text: reply }] }] })}`,
      ""
    ].join("\n\n");
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const app = await fixture(agentFetch);
  t.after(() => app.close());
  await jsonRequest(app.baseUrl, "/api/accounts/miniapp-default", {
    method: "PUT",
    body: { agentApiUrl: "https://agent.example.test/openapi/chat", agentApiKey: "secret", agentId: "sales-agent" }
  });
  const machine = await jsonRequest(app.baseUrl, "/api/flow-machines/miniapp-default");
  await jsonRequest(app.baseUrl, "/api/flow-machines/miniapp-default", { method: "PUT", body: { enabled: true, config: machine.data.machine.config } });
  const schema = await jsonRequest(app.baseUrl, "/api/tag-schemas/miniapp-default");
  await jsonRequest(app.baseUrl, "/api/tag-schemas/miniapp-default", { method: "PUT", body: { schema: { ...schema.data.schema, dateTag: { enabled: false }, groups: [] } } });

  const received = await jsonRequest(app.baseUrl, "/api/channels/miniapp/miniapp-default/events", { method: "POST", body: inbound() });
  assert.equal(received.data.items[0].handledBy, "agent");
  const outbox = await jsonRequest(app.baseUrl, "/api/channels/miniapp/miniapp-default/conversations/session-1/outbox?after=0");
  assert.equal(outbox.data.items[0].content, "收到");
});

test("Agent Gateway retries a contract-invalid response with validation feedback", async (t) => {
  const calls = [];
  const agentFetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push({ key: options.headers["Idempotency-Key"], message: request.message });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ reply: "缺少流程决策" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const payload = JSON.parse(request.message.split("\n").find((line) => line.startsWith("{") && line.endsWith("}")));
    const current = payload.flow.currentNode.id;
    return new Response(JSON.stringify({
      reply: "已修正",
      flowDecision: { currentNodeId: current, nodeCompleted: false, nextNodeId: current, collectedDataPatch: {}, reason: "继续当前节点" },
      tagEvaluation: [],
      tagDecision: { add: [], remove: [] },
      attentionAlert: { required: false, reason: "", evidenceMessageId: "", evidenceText: "" }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const app = await fixture(agentFetch);
  t.after(() => app.close());
  await jsonRequest(app.baseUrl, "/api/accounts/miniapp-default", {
    method: "PUT",
    body: { agentApiUrl: "https://agent.example.test/openapi/chat", agentApiKey: "secret", agentId: "sales-agent" }
  });
  const machine = await jsonRequest(app.baseUrl, "/api/flow-machines/miniapp-default");
  await jsonRequest(app.baseUrl, "/api/flow-machines/miniapp-default", { method: "PUT", body: { enabled: true, config: machine.data.machine.config } });
  const schema = await jsonRequest(app.baseUrl, "/api/tag-schemas/miniapp-default");
  await jsonRequest(app.baseUrl, "/api/tag-schemas/miniapp-default", { method: "PUT", body: { schema: { ...schema.data.schema, dateTag: { enabled: false }, groups: [] } } });

  const received = await jsonRequest(app.baseUrl, "/api/channels/miniapp/miniapp-default/events", { method: "POST", body: inbound() });
  assert.equal(received.data.items[0].handledBy, "agent");
  assert.equal(calls.length, 2);
  assert.match(calls[1].message, /flowDecision is required/);
  assert.notEqual(calls[0].key, calls[1].key);
});

test("flow activation is scheduled, delivered through the channel adapter, and canceled by a customer reply", async (t) => {
  const app = await fixture();
  t.after(() => app.close());
  const machine = (await jsonRequest(app.baseUrl, "/api/flow-machines/website-default")).data.machine;
  machine.config.nodes[0].activation = {
    enabled: true,
    polishByAgent: false,
    messages: [{ content: "还有什么可以帮您？", intervalMinutes: 0, maxTimes: 2 }]
  };
  await jsonRequest(app.baseUrl, "/api/flow-machines/website-default", { method: "PUT", body: { enabled: true, config: machine.config } });

  await jsonRequest(app.baseUrl, "/api/channels/website/website-default/events", { method: "POST", body: inbound() });
  app.db.prepare("UPDATE activation_tasks SET due_at = '2000-01-01T00:00:00.000Z' WHERE status = 'pending'").run();
  const firstRun = await app.services.activation.runDue();
  assert.equal(firstRun.length, 2);
  assert.deepEqual(firstRun.map((item) => item.status), ["sent", "sent"]);

  await jsonRequest(app.baseUrl, "/api/channels/website/website-default/events", { method: "POST", body: inbound({ eventId: "event-2", messageId: "message-2", text: "我再想想" }) });
  const pendingBefore = app.db.prepare("SELECT COUNT(*) AS count FROM activation_tasks WHERE status = 'pending'").get().count;
  assert.equal(pendingBefore, 2);
  await jsonRequest(app.baseUrl, "/api/channels/website/website-default/events", { method: "POST", body: inbound({ eventId: "event-3", messageId: "message-3", text: "先不用了" }) });
  const canceled = app.db.prepare("SELECT COUNT(*) AS count FROM activation_tasks WHERE status = 'canceled'").get().count;
  assert.equal(canceled, 2);
});
