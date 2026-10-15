#!/usr/bin/env node

const baseUrl = String(process.env.DCLAW_AGENT_SERVICE_URL || "http://127.0.0.1:4310").replace(/\/$/, "");
const accountId = "miniapp-default";
const provider = "miniapp";
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "");

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} failed (${response.status}): ${text.slice(0, 500)}`);
  return data;
}

function inbound(externalConversationId, displayName, text, ordinal) {
  const key = `${runId}-${externalConversationId}-${ordinal}`;
  return {
    event_id: `evt-${key}`,
    occurred_at: new Date().toISOString(),
    conversation: { id: externalConversationId, user_id: `user-${externalConversationId}`, display_name: displayName },
    message: { id: `msg-${key}`, type: "text", text }
  };
}

async function send(externalConversationId, displayName, text, ordinal) {
  const result = await api(`/api/channels/${provider}/${accountId}/events`, {
    method: "POST",
    body: inbound(externalConversationId, displayName, text, ordinal)
  });
  const item = result.items?.[0];
  if (!item || item.handledBy === "error") throw new Error(`${externalConversationId} turn ${ordinal}: ${item?.error || "missing result"}`);
  return item;
}

async function outbox(externalConversationId) {
  return (await api(`/api/channels/${provider}/${accountId}/conversations/${encodeURIComponent(externalConversationId)}/outbox?after=0`)).items;
}

async function waitForOutbox(externalConversationId, minimum, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const items = await outbox(externalConversationId);
    if (items.length >= minimum) return items;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${externalConversationId}: outbox did not reach ${minimum} messages`);
}

async function snapshot(externalConversationId) {
  const rows = (await api(`/api/accounts/${accountId}/conversations`)).items;
  const row = rows.find((item) => item.externalConversationId === externalConversationId);
  if (!row) throw new Error(`${externalConversationId}: conversation not found`);
  const conversation = await api(`/api/conversations/${row.id}`);
  const messages = (await api(`/api/conversations/${row.id}/messages`)).items;
  const flowEvents = (await api(`/api/conversations/${row.id}/flow-events`)).items;
  const alerts = (await api(`/api/accounts/${accountId}/alerts?status=`)).items.filter((item) => item.conversationId === row.id);
  return { conversation, messages, flowEvents, alerts, outbox: await outbox(externalConversationId) };
}

function hasTag(snapshotValue, tagId) {
  return snapshotValue.conversation.tags.some((tag) => tag.tagId === tagId);
}

function check(checks, name, condition, detail = "") {
  checks.push({ name, passed: Boolean(condition), detail });
}

async function runFullFlow() {
  const externalConversationId = `wuhe-full-${runId}`;
  const displayName = "智能名片测试-完整流程";
  await send(externalConversationId, displayName, "是的，我想领取AI学习资料", 1);
  await waitForOutbox(externalConversationId, 2);
  await send(externalConversationId, displayName, "我是工作族，零基础，学习目的是转行", 2);
  await waitForOutbox(externalConversationId, 4);
  await send(externalConversationId, displayName, "资料可以打开，已经收好了，谢谢", 3);
  await waitForOutbox(externalConversationId, 6);
  await send(externalConversationId, displayName, "我想参加直播，也把课程老师微信二维码发我", 4);
  const finalOutbox = await waitForOutbox(externalConversationId, 7);
  const value = await snapshot(externalConversationId);
  const checks = [];
  const card = finalOutbox.flatMap((item) => item.attachments || []).find((item) => item.type === "card");
  const qr = finalOutbox.flatMap((item) => item.attachments || []).find((item) => item.type === "image" && /二维码/u.test(item.name || item.title || ""));
  check(checks, "flow reached teacher_handoff", value.conversation.state === "teacher_handoff", value.conversation.state);
  check(checks, "identity collected", value.conversation.flowSession?.collectedData?.["身份类型"] !== undefined, JSON.stringify(value.conversation.flowSession?.collectedData || {}));
  check(checks, "foundation collected", value.conversation.flowSession?.collectedData?.["基础情况"] !== undefined);
  check(checks, "learning goal collected", value.conversation.flowSession?.collectedData?.["学习目的"] !== undefined);
  check(checks, "material card delivered", Boolean(card?.url), card?.url || "missing");
  check(checks, "teacher QR delivered", Boolean(qr?.url), qr?.url || "missing");
  check(checks, "working identity tag", hasTag(value, "wuhe_identity_working"));
  check(checks, "zero foundation tag", hasTag(value, "wuhe_foundation_zero"));
  check(checks, "career change tag", hasTag(value, "wuhe_goal_career_change"));
  check(checks, "materials milestone tag", hasTag(value, "wuhe_materials_sent"));
  check(checks, "live invite milestone tag", hasTag(value, "wuhe_live_invite_sent"));
  check(checks, "teacher contact milestone tag", hasTag(value, "wuhe_teacher_contact_sent"));
  return { id: "full-flow", externalConversationId, checks, snapshot: value };
}

async function runHandoffScenario({ id, displayName, text, expectedTag }) {
  const externalConversationId = `${id}-${runId}`;
  const first = await send(externalConversationId, displayName, text, 1);
  await waitForOutbox(externalConversationId, 1);
  const before = await snapshot(externalConversationId);
  const second = await send(externalConversationId, displayName, "补充一条消息，确认人工接管后不再调用AI", 2);
  const after = await snapshot(externalConversationId);
  const checks = [];
  check(checks, "first turn handled by agent", first.handledBy === "agent", first.handledBy);
  check(checks, "expected tag applied", hasTag(before, expectedTag), expectedTag);
  check(checks, "voice alert created", before.alerts.some((item) => item.title.startsWith("标签提醒：")), before.alerts.map((item) => item.title).join(", "));
  check(checks, "conversation switched to human", before.conversation.mode === "human", before.conversation.mode);
  check(checks, "next turn handled by human", second.handledBy === "human", second.handledBy);
  check(checks, "human turn produced no automatic reply", after.outbox.length === before.outbox.length, `${before.outbox.length} -> ${after.outbox.length}`);
  return { id, externalConversationId, checks, snapshot: after };
}

async function runReviewAlert() {
  const externalConversationId = `review-alert-${runId}`;
  await send(externalConversationId, "智能名片测试-事项待核", "资料链接反复打不开，基础排查后还是无法使用，请助教核对资料权限", 1);
  await waitForOutbox(externalConversationId, 1);
  const value = await snapshot(externalConversationId);
  const checks = [];
  check(checks, "review tag applied", hasTag(value, "wuhe_reception_review"));
  check(checks, "review voice alert created", value.alerts.some((item) => item.title.includes("接待事项待核")), value.alerts.map((item) => item.title).join(", "));
  check(checks, "review remains AI mode", value.conversation.mode === "ai", value.conversation.mode);
  return { id: "review-alert", externalConversationId, checks, snapshot: value };
}

const configuration = {
  account: await api(`/api/accounts/${accountId}`),
  flow: (await api(`/api/flow-machines/${accountId}`)).machine,
  tags: (await api(`/api/tag-schemas/${accountId}`)).schema
};
const scenarios = [];
scenarios.push(await runFullFlow());
scenarios.push(await runReviewAlert());
scenarios.push(await runHandoffScenario({
  id: "enrollment-handoff",
  displayName: "智能名片测试-报名接管",
  text: "我要报名购买付费课程，请人工帮我办理支付",
  expectedTag: "wuhe_enrollment"
}));
scenarios.push(await runHandoffScenario({
  id: "payment-complaint-handoff",
  displayName: "智能名片测试-支付投诉",
  text: "我已经付款但没有到账，现在要求退款并投诉，请人工处理",
  expectedTag: "wuhe_payment_complaint"
}));

const checks = scenarios.flatMap((scenario) => scenario.checks.map((item) => ({ scenario: scenario.id, ...item })));
const report = {
  schemaVersion: "wuhe-miniapp-acceptance.v1",
  runId,
  baseUrl,
  configuration: {
    accountId: configuration.account.id,
    provider: configuration.account.provider,
    agentId: configuration.account.agentId,
    agentApiKeyConfigured: configuration.account.agentApiKeyConfigured,
    flowName: configuration.flow.config.name,
    flowVersion: configuration.flow.config.version,
    flowNodeIds: configuration.flow.config.nodes.map((node) => node.id),
    tagVersion: configuration.tags.version,
    tagGroups: configuration.tags.groups.map((group) => ({ id: group.id, name: group.name, tagCount: group.tags.length }))
  },
  summary: {
    scenarioCount: scenarios.length,
    checkCount: checks.length,
    passed: checks.filter((item) => item.passed).length,
    failed: checks.filter((item) => !item.passed).length
  },
  scenarios
};
console.log(JSON.stringify(report, null, 2));
if (report.summary.failed) process.exitCode = 1;
