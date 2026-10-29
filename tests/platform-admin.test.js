import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { once } from "node:events";
import { createApp } from "../src/app.js";

async function fixture(fetchImpl = globalThis.fetch) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-agent-admin-"));
  const context = createApp({ databasePath: path.join(directory, "test.sqlite"), agentTimeoutMs: 5000, deliveryMaxAttempts: 1, credentialEncryptionKey: "platform-admin-test-key", wechatSessionTtlDays: 30 }, { fetchImpl });
  const server = context.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    ...context,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      context.db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  return { response, data: response.status === 204 ? null : await response.json() };
}

test("seed migrates the two real channels into one workspace and removes local demo", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const workspaces = await request(app.baseUrl, "/api/admin/workspaces");
  assert.equal(workspaces.data.items.length, 1);
  assert.equal(workspaces.data.items[0].name, "顶脉教育集团");
  assert.equal(workspaces.data.items[0].personCount, 1);
  assert.equal(workspaces.data.items[0].channelCount, 2);

  const accounts = await request(app.baseUrl, "/api/accounts?workspace=dingmai");
  assert.deepEqual(new Set(accounts.data.items.map((item) => item.provider)), new Set(["website", "miniapp"]));

  const channelTypes = await request(app.baseUrl, "/api/admin/channel-types");
  const websiteFields = channelTypes.data.items.find((item) => item.provider === "website").channelFields;
  assert.ok(websiteFields.some((field) => field.key === "homepageImageUrl" && field.type === "image"));
  assert.ok(websiteFields.some((field) => field.key === "companyName" && field.colorKey === "companyNameColor"));
  assert.ok(websiteFields.some((field) => field.key === "heroButtonUrl" && field.pattern === "https?://.+"));
  assert.ok(websiteFields.some((field) => field.key === "launcherPositionX" && field.type === "hidden"));
  assert.ok(websiteFields.some((field) => field.key === "launcherPositionY" && field.type === "hidden"));
  assert.equal(websiteFields.some((field) => field.key === "position"), false);
  assert.equal(accounts.data.items.some((item) => item.id === "fake-demo"), false);
  assert.ok(accounts.data.items.filter((item) => item.personId).every((item) => item.person?.name === "向小顶"));
  assert.equal(accounts.data.items.filter((item) => !item.personId).length, 2);
});

test("workspace miniapp credentials are encrypted and never returned to the admin browser", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const saved = await request(app.baseUrl, "/api/admin/workspaces/dingmai/miniapp", { method: "PUT", body: {
    mode: "dedicated",
    name: "顶脉智能名片",
    appId: "wx48fa13a3cc0dcf72",
    appSecret: "server-only-secret",
    originalId: "gh_test"
  } });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.appSecretConfigured, true);
  assert.equal(saved.data.appSecret, "");
  assert.equal(saved.data.encryptedAppSecret, undefined);

  const stored = app.store.getWorkspaceMiniapp("dingmai", { includeSecrets: true });
  assert.notEqual(stored.encryptedAppSecret, "server-only-secret");
  assert.match(stored.encryptedAppSecret, /^v1\./);

  const fetched = await request(app.baseUrl, "/api/admin/workspaces/dingmai/miniapp");
  assert.equal(fetched.data.config.appId, "wx48fa13a3cc0dcf72");
  assert.equal("encryptedAppSecret" in fetched.data.config, false);

  const updated = await request(app.baseUrl, "/api/admin/workspaces/dingmai/miniapp", { method: "PUT", body: {
    mode: "dedicated",
    name: "顶脉智能名片（已更新）",
    appId: "wx48fa13a3cc0dcf72",
    originalId: "gh_test"
  } });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.name, "顶脉智能名片（已更新）");
  assert.equal(app.store.getWorkspaceMiniapp("dingmai", { includeSecrets: true }).encryptedAppSecret, stored.encryptedAppSecret);
});

test("employee cockpit aggregates business results across website and miniapp channels", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const inbound = (accountId, provider, suffix) => app.store.recordInbound({
    provider,
    accountId,
    eventId: `dashboard-${suffix}`,
    occurredAt: new Date().toISOString(),
    externalConversationId: `dashboard-conversation-${suffix}`,
    externalUserId: `dashboard-user-${suffix}`,
    displayName: `驾驶舱访客 ${suffix}`,
    externalMessageId: `dashboard-message-${suffix}`,
    messageType: "text",
    text: "了解服务",
    attachments: [],
    metadata: {}
  });
  const website = inbound("website-default", "website", "website");
  const miniapp = inbound("miniapp-default", "miniapp", "miniapp");
  app.store.recordAgentUsage({ accountId: "website-default", workspaceId: "dingmai", personId: "wuhe-assistant", conversationId: website.conversation.id, status: "succeeded", durationMs: 1200 });
  app.store.recordAgentUsage({ accountId: "miniapp-default", workspaceId: "dingmai", personId: "wuhe-assistant", conversationId: miniapp.conversation.id, status: "failed", durationMs: 0 });

  const cockpit = await request(app.baseUrl, "/api/accounts/website-default/dashboard");
  assert.equal(cockpit.response.status, 200);
  assert.equal(cockpit.data.scope.type, "employee");
  assert.deepEqual(new Set(cockpit.data.scope.accountIds), new Set(["website-default", "miniapp-default"]));
  assert.equal(cockpit.data.today.visitors, 2);
  assert.equal(cockpit.data.today.inboundMessages, 2);
  assert.equal(cockpit.data.agent.requests, 2);
  assert.equal(cockpit.data.agent.successRate, 50);
  assert.deepEqual(new Set(cockpit.data.channels.map((item) => item.provider)), new Set(["website", "miniapp"]));
  assert.ok(cockpit.data.channels.every((item) => item.visitorsToday === 1));
  assert.equal(cockpit.data.trend.at(-1).visitors, 2);
});

test("website homepage button only accepts complete HTTP or HTTPS URLs", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const invalid = await request(app.baseUrl, "/api/admin/channels/wuhe-website", { method: "PUT", body: { config: { heroButtonUrl: "/about" } } });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.data.error, /HTTP.*HTTPS/);

  const valid = await request(app.baseUrl, "/api/admin/channels/wuhe-website", { method: "PUT", body: { config: { heroButtonUrl: "https://www.example.com/about" } } });
  assert.equal(valid.response.status, 200);
  assert.equal(valid.data.config.heroButtonUrl, "https://www.example.com/about");
});

test("Agent binding resolves person then workspace then platform without copying credentials", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  await request(app.baseUrl, "/api/admin/agent-bindings/platform/default", { method: "PUT", body: { name: "平台", agentApiUrl: "https://platform.test/chat", agentApiKey: "platform-key", agentId: "platform-agent" } });
  let account = app.store.getAccount("miniapp-default", { includeSecrets: true });
  assert.equal(account.agentBinding.inheritedFrom, "platform");
  assert.equal(account.agentApiKey, "platform-key");

  await request(app.baseUrl, "/api/admin/agent-bindings/workspace/dingmai", { method: "PUT", body: { name: "工作区", agentApiUrl: "https://workspace.test/chat", agentApiKey: "workspace-key", agentId: "workspace-agent" } });
  account = app.store.getAccount("miniapp-default", { includeSecrets: true });
  assert.equal(account.agentBinding.inheritedFrom, "workspace");

  let assistantAccount = app.store.getAccount("wuhe-miniapp-company-assistant", { includeSecrets: true });
  assert.equal(assistantAccount.agentBinding.inheritedFrom, "workspace");
  await request(app.baseUrl, "/api/admin/agent-bindings/assistant/wuhe-miniapp", { method: "PUT", body: { name: "公司助手", agentApiUrl: "https://assistant.test/chat", agentApiKey: "assistant-key", agentId: "assistant-agent" } });
  assistantAccount = app.store.getAccount("wuhe-miniapp-company-assistant", { includeSecrets: true });
  assert.equal(assistantAccount.agentBinding.inheritedFrom, "assistant");
  assert.equal(assistantAccount.agentId, "assistant-agent");

  await request(app.baseUrl, "/api/admin/agent-bindings/person/wuhe-assistant", { method: "PUT", body: { name: "人物", agentApiUrl: "https://person.test/chat", agentApiKey: "person-key", agentId: "person-agent", billingLabel: "person-bill" } });
  account = app.store.getAccount("miniapp-default", { includeSecrets: true });
  assert.equal(account.agentBinding.inheritedFrom, "person");
  assert.equal(account.agentId, "person-agent");
  assert.equal(account.agentBinding.billingLabel, "person-bill");

  const publicAccount = await request(app.baseUrl, "/api/accounts/miniapp-default");
  assert.equal(publicAccount.data.agentApiKey, "••••••••");
});

test("Agent catalog supplies one required default with optional channel and person bindings", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const personAgent = await request(app.baseUrl, "/api/admin/agents", { method: "POST", body: {
    id: "person-agent", name: "个人名片 Agent", agentApiUrl: "https://person-catalog.test/chat", agentApiKey: "person-catalog-key", agentId: "person-catalog", billingLabel: "person"
  } });
  const assistantAgent = await request(app.baseUrl, "/api/admin/agents", { method: "POST", body: {
    id: "assistant-agent", name: "公司助手 Agent", agentApiUrl: "https://assistant-catalog.test/chat", agentApiKey: "assistant-catalog-key", agentId: "assistant-catalog", billingLabel: "assistant"
  } });
  assert.equal(personAgent.response.status, 201);
  assert.equal(assistantAgent.response.status, 201);
  assert.equal(personAgent.data.concurrencyLimit, 0);
  assert.equal(personAgent.data.billingLabel, "");

  const defaults = await request(app.baseUrl, "/api/admin/agent-defaults", { method: "PUT", body: {
    defaultAgentConfigId: "person-agent"
  } });
  assert.equal(defaults.data.defaults.defaultAgentConfigId, "person-agent");

  let personAccount = app.store.getAccount("miniapp-default", { includeSecrets: true });
  let assistantAccount = app.store.getAccount("wuhe-miniapp-company-assistant", { includeSecrets: true });
  assert.equal(personAccount.agentBinding.id, "person-agent");
  assert.equal(personAccount.agentBinding.inheritedFrom, "platform-default");
  assert.equal(personAccount.agentApiKey, "person-catalog-key");
  assert.equal(assistantAccount.agentBinding.id, "person-agent");
  assert.equal(assistantAccount.agentBinding.inheritedFrom, "platform-default");

  const person = await request(app.baseUrl, "/api/admin/people/wuhe-assistant", { method: "PUT", body: { agentConfigId: "assistant-agent" } });
  const channel = await request(app.baseUrl, "/api/admin/channels/wuhe-miniapp", { method: "PUT", body: { assistantAgentConfigId: "person-agent" } });
  assert.equal(person.data.agentConfigId, "assistant-agent");
  assert.equal(channel.data.assistantAgentConfigId, "person-agent");

  personAccount = app.store.getAccount("miniapp-default", { includeSecrets: true });
  assistantAccount = app.store.getAccount("wuhe-miniapp-company-assistant", { includeSecrets: true });
  assert.equal(personAccount.agentBinding.id, "assistant-agent");
  assert.equal(personAccount.agentBinding.inheritedFrom, "person");
  assert.equal(assistantAccount.agentBinding.id, "person-agent");
  assert.equal(assistantAccount.agentBinding.inheritedFrom, "assistant");

  await request(app.baseUrl, "/api/admin/people/wuhe-assistant", { method: "PUT", body: { agentConfigId: "" } });
  await request(app.baseUrl, "/api/admin/channels/wuhe-miniapp", { method: "PUT", body: { assistantAgentConfigId: "" } });
  personAccount = app.store.getAccount("miniapp-default", { includeSecrets: true });
  assistantAccount = app.store.getAccount("wuhe-miniapp-company-assistant", { includeSecrets: true });
  assert.equal(personAccount.agentBinding.id, "person-agent");
  assert.equal(personAccount.agentBinding.inheritedFrom, "platform-default");
  assert.equal(assistantAccount.agentBinding.id, "person-agent");
  assert.equal(assistantAccount.agentBinding.inheritedFrom, "platform-default");

  const catalog = await request(app.baseUrl, "/api/admin/agents");
  assert.equal(catalog.data.items.find((item) => item.id === "person-agent").agentApiKey, "••••••••");
  assert.equal(catalog.data.items.find((item) => item.id === "person-agent").isDefault, true);
  assert.equal(catalog.data.items.find((item) => item.id === "assistant-agent").isDefault, false);
  assert.deepEqual(catalog.data.defaults, { defaultAgentConfigId: "person-agent" });
  const deleteDefault = await request(app.baseUrl, "/api/admin/agents/person-agent", { method: "DELETE" });
  assert.equal(deleteDefault.response.status, 400);
});

test("published web card reaches the configured DClaw Agent and returns its reply", async (t) => {
  const calls = [];
  const agentFetch = async (url, options) => {
    const requestBody = JSON.parse(options.body);
    const context = JSON.parse(requestBody.message.split("\n").at(-1));
    calls.push({ url: String(url), headers: options.headers, requestBody, context });
    const reply = JSON.stringify({
      reply: "您好，我是向小顶。可以直接告诉我您想了解的业务。",
      tagEvaluation: context.tagRules.groups.flatMap((group) => group.tags.map((tag) => ({
        groupId: group.id,
        tagId: tag.id,
        matched: false,
        reason: "当前消息未命中该标签"
      }))),
      tagDecision: { add: [], remove: [] },
      attentionAlert: { required: false },
      handoff: false
    });
    const splitAt = Math.floor(reply.length / 2);
    const stream = [
      `data: ${JSON.stringify({ object: "response", status: "created", session_id: "open:test" })}\n\n`,
      `data: ${JSON.stringify({ object: "content", type: "text", delta: true, text: reply.slice(0, splitAt) })}\n\n`,
      `data: ${JSON.stringify({ object: "content", type: "text", delta: true, text: reply.slice(splitAt) })}`
    ].join("");
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const app = await fixture(agentFetch);
  t.after(() => app.close());

  await request(app.baseUrl, "/api/admin/agents/platform-default", { method: "PUT", body: {
    name: "平台默认 Agent",
    agentApiUrl: "https://dclaw.example.test",
    agentApiKey: "test-key",
    agentId: "card_agent"
  } });
  await request(app.baseUrl, "/api/admin/channels/wuhe-miniapp/publish", { method: "POST" });

  const sent = await request(app.baseUrl, "/api/public/channels/wuhe-assistant/messages", { method: "POST", body: {
    conversationId: "web-card-conversation-001",
    userId: "web-card-visitor-001",
    displayName: "Web 名片访客",
    message: { id: "web-card-message-001", type: "text", text: "你好，请介绍一下自己" }
  } });
  assert.equal(sent.response.status, 202);
  assert.equal(sent.data.items[0].handledBy, "agent");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://dclaw.example.test/api/open/v1/targets/card_agent/messages");
  assert.equal(calls[0].headers.Authorization, "Bearer test-key");
  assert.equal(calls[0].requestBody.metadata.source, "dclaw-agent-service");
  assert.equal(calls[0].requestBody.metadata.deployment_id, "wuhe-miniapp-assistant");
  assert.equal(calls[0].context.tenantContext.person.name, "向小顶");

  const outbox = await request(app.baseUrl, "/api/public/channels/wuhe-assistant/conversations/web-card-conversation-001/outbox?after=0");
  assert.equal(outbox.response.status, 200);
  assert.equal(outbox.data.items.length, 1);
  assert.equal(outbox.data.items[0].content, "您好，我是向小顶。可以直接告诉我您想了解的业务。");
});

test("admin preview conversations use separate person and company-assistant accounts", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const personReply = await request(app.baseUrl, "/api/admin/deployments/wuhe-miniapp-assistant/preview/messages", { method: "POST", body: {
    conversationId: "admin-person-preview-001",
    userId: "admin-preview-user-001",
    message: { id: "admin-person-message-001", type: "text", text: "介绍一下自己" }
  } });
  assert.equal(personReply.response.status, 202);
  const personConversation = app.store.getConversation(personReply.data.items[0].conversationId);
  assert.equal(personConversation.accountId, "miniapp-default");
  assert.equal(app.store.listMessages(personConversation.id)[0].metadata.surface, "admin-preview");

  app.store.setConversationMode(personConversation.id, "human", { operator: "test", note: "模拟预览会话被人工接管" });
  const resumedPersonReply = await request(app.baseUrl, "/api/admin/deployments/wuhe-miniapp-assistant/preview/messages", { method: "POST", body: {
    conversationId: "admin-person-preview-001",
    userId: "admin-preview-user-001",
    message: { id: "admin-person-message-002", type: "text", text: "继续测试 Agent" }
  } });
  assert.equal(resumedPersonReply.response.status, 202);
  assert.equal(resumedPersonReply.data.items[0].handledBy, "agent");
  assert.equal(app.store.getConversation(personConversation.id).mode, "ai");

  const assistantReply = await request(app.baseUrl, "/api/admin/deployments/wuhe-miniapp-assistant/preview/assistant/messages", { method: "POST", body: {
    conversationId: "admin-assistant-preview-001",
    userId: "admin-preview-user-001",
    message: { id: "admin-assistant-message-001", type: "text", text: "介绍公司服务" }
  } });
  assert.equal(assistantReply.response.status, 202);
  const assistantConversation = app.store.getConversation(assistantReply.data.items[0].conversationId);
  assert.equal(assistantConversation.accountId, "wuhe-miniapp-company-assistant");
  assert.equal(app.store.listMessages(assistantConversation.id)[0].metadata.surface, "admin-preview-assistant");
});

test("channel draft is private until publish and preview is schema-versioned", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const draft = await request(app.baseUrl, "/api/admin/deployments/wuhe-miniapp-assistant/preview");
  assert.equal(draft.data.channelType, "miniapp");
  assert.equal(draft.data.schemaVersion, 2);
  assert.equal(draft.data.person.name, "向小顶");
  assert.equal(draft.data.person.title, "总裁");
  assert.equal(draft.data.person.avatarUrl, "/console/assets/bot-avatar.png");
  assert.equal(draft.data.workspace.name, "顶脉教育集团");
  assert.equal(draft.data.channel.config.voiceEnabled, true);
  assert.equal(draft.data.channel.config.assistantName, "D仔");
  assert.equal(draft.data.channel.config.assistantNameColor, "#29466f");
  assert.equal(draft.data.channel.config.assistantBrandText, "DClaw");
  assert.equal(draft.data.channel.config.assistantMascotImageUrl, "/console/assets/ddeer-transparent.png");
  assert.equal(draft.data.channel.config.assistantSceneVideoUrl, "/console/assets/ddeer-office-greeting-rig-v3.mp4");
  assert.equal(draft.data.channel.config.assistantScenePosterUrl, "/console/assets/ddeer-office-greeting-rig-poster-v3.jpg");
  assert.equal(draft.data.channel.config.assistantSceneImageUrl, "/console/assets/ddeer-transparent.png");
  const assistantVideo = await fetch(`${app.baseUrl}${draft.data.channel.config.assistantSceneVideoUrl}`);
  assert.equal(assistantVideo.status, 200);
  assert.match(assistantVideo.headers.get("content-type"), /video\/mp4/);
  assert.ok((await assistantVideo.arrayBuffer()).byteLength > 0);
  const assistantPoster = await fetch(`${app.baseUrl}/console/assets/ddeer-office-greeting-rig-poster-v3.jpg`);
  assert.equal(assistantPoster.status, 200);
  assert.match(assistantPoster.headers.get("content-type"), /image\/jpeg/);
  assert.ok((await assistantPoster.arrayBuffer()).byteLength > 0);
  assert.deepEqual(draft.data.channel.config.assistantTopics, ["集团业务介绍", "课程与服务", "合作咨询", "联系我们"]);
  assert.deepEqual(draft.data.channel.config.assistantPrimaryItems, ["了解集团服务", "查看课程体系", "领取合作资料"]);
  assert.deepEqual(draft.data.channel.config.assistantRecommendedItems, ["热门方案推荐", "企业合作咨询", "预约专属服务"]);
  assert.equal(draft.data.deployments.length, 1);
  assert.equal(draft.data.deployments[0].person.name, "向小顶");
  assert.equal(draft.data.deployment.config.companyName, "顶脉教育集团");
  assert.equal(draft.data.deployment.config.wechat, "dingmai-ai");
  assert.equal(draft.data.deployment.config.email, "service@dingmai.example");
  assert.equal(draft.data.deployment.config.website, "https://www.dingmai.example");
  assert.equal(draft.data.deployment.config.address, "杭州市滨江区江南大道 88 号");
  assert.equal(draft.data.deployment.config.qrCodeUrl, "/console/assets/contact-qr-demo.png");
  assert.equal(draft.data.deployment.config.leadForm.enabled, true);

  const websiteDraft = await request(app.baseUrl, "/api/admin/deployments/wuhe-website-assistant/preview");
  assert.equal(websiteDraft.data.channelType, "website");
  assert.equal("cardPresentation" in websiteDraft.data, false);
  assert.equal("cardConfig" in websiteDraft.data.deployment, false);
  assert.equal(websiteDraft.data.deployment.config.coverUrl, "/console/assets/moosee-work-serious-scene.png");
  assert.equal(websiteDraft.data.deployments[0].config.companyName, "顶脉教育集团");

  const channelPreview = await request(app.baseUrl, "/api/admin/channels/wuhe-miniapp/preview");
  assert.equal(channelPreview.data.previewOnly, undefined);
  assert.equal(channelPreview.data.person.name, "向小顶");
  assert.equal(channelPreview.data.deployment.id, "wuhe-miniapp-assistant");
  assert.equal(channelPreview.data.endpoints.publicMessages, "/api/admin/deployments/wuhe-miniapp-assistant/preview/messages");

  const websiteChannelPreview = await request(app.baseUrl, "/api/admin/channels/wuhe-website/preview");
  assert.equal(websiteChannelPreview.data.previewOnly, undefined);
  assert.equal(websiteChannelPreview.data.person.name, "向小顶");
  assert.equal(websiteChannelPreview.data.deployment.id, "wuhe-website-assistant");
  assert.equal(websiteChannelPreview.data.endpoints.publicMessages, "/api/admin/deployments/wuhe-website-assistant/preview/messages");

  const uploadedVideo = await fetch(`${app.baseUrl}/api/admin/media`, {
    method: "POST",
    headers: { "content-type": "video/mp4", "x-file-name": encodeURIComponent("D仔循环.mp4") },
    body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])
  });
  assert.equal(uploadedVideo.status, 201);
  const uploadedAsset = await uploadedVideo.json();
  assert.equal(uploadedAsset.asset.type, "video");
  assert.equal(uploadedAsset.asset.name, "D仔循环.mp4");
  assert.match(uploadedAsset.asset.url, /^\/media\/[a-f0-9-]+\.mp4$/);
  assert.equal((await fetch(`${app.baseUrl}${uploadedAsset.asset.url}`)).status, 200);

  const uploadedImage = await fetch(`${app.baseUrl}/api/admin/media`, {
    method: "POST",
    headers: { "content-type": "image/webp", "x-file-name": encodeURIComponent("公司助手.webp") },
    body: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])
  });
  assert.equal(uploadedImage.status, 201);
  const uploadedImageAsset = await uploadedImage.json();
  assert.equal(uploadedImageAsset.asset.type, "image");
  assert.equal(uploadedImageAsset.asset.name, "公司助手.webp");
  assert.match(uploadedImageAsset.asset.url, /^\/media\/[a-f0-9-]+\.webp$/);
  assert.equal((await fetch(`${app.baseUrl}${uploadedImageAsset.asset.url}`)).status, 200);

  const channelConfig = {
    ...draft.data.channel.config,
    assistantName: "顶脉企业助手",
    assistantBrandText: "顶脉教育",
    assistantMascotImageUrl: uploadedImageAsset.asset.url,
    assistantSceneVideoUrl: "",
    assistantScenePosterUrl: uploadedImageAsset.asset.url,
    assistantSceneImageUrl: uploadedImageAsset.asset.url,
    voiceEnabled: false,
    leadFormEnabled: true
  };
  const personProfile = {
    ...draft.data.deployment.config,
    coverUrl: uploadedImageAsset.asset.url,
    leadFormEnabled: false
  };
  await request(app.baseUrl, "/api/admin/channels/wuhe-miniapp", { method: "PUT", body: { config: channelConfig } });
  await request(app.baseUrl, "/api/admin/people/wuhe-assistant", { method: "PUT", body: { profile: personProfile } });
  const configuredDraft = await request(app.baseUrl, "/api/admin/deployments/wuhe-miniapp-assistant/preview");
  assert.equal(configuredDraft.data.channel.config.assistantName, "顶脉企业助手");
  assert.equal(configuredDraft.data.channel.config.assistantBrandText, "顶脉教育");
  assert.equal(configuredDraft.data.channel.config.assistantMascotImageUrl, uploadedImageAsset.asset.url);
  assert.equal(configuredDraft.data.channel.config.assistantSceneVideoUrl, "");
  assert.equal(configuredDraft.data.channel.config.voiceEnabled, false);
  assert.equal(configuredDraft.data.deployment.config.coverUrl, uploadedImageAsset.asset.url);
  assert.equal(configuredDraft.data.deployment.config.leadFormEnabled, false);

  const unavailable = await request(app.baseUrl, "/api/public/channels/wuhe-assistant");
  assert.equal(unavailable.response.status, 404);

  const published = await request(app.baseUrl, "/api/admin/channels/wuhe-miniapp/publish", { method: "POST" });
  assert.equal(published.data.publishedVersion, 1);
  const publicView = await request(app.baseUrl, "/api/public/channels/wuhe-assistant");
  assert.equal(publicView.response.status, 200);
  assert.equal(publicView.data.mode, "published");
  assert.equal(publicView.data.channel.config.assistantName, "顶脉企业助手");
  assert.equal(publicView.data.channel.config.assistantBrandText, "顶脉教育");
  assert.equal(publicView.data.channel.config.assistantMascotImageUrl, uploadedImageAsset.asset.url);
  assert.equal(publicView.data.channel.config.assistantSceneVideoUrl, "");
  assert.equal(publicView.data.channel.config.assistantSceneImageUrl, uploadedImageAsset.asset.url);
  assert.equal(publicView.data.channel.config.voiceEnabled, false);
  assert.equal(publicView.data.deployment.config.coverUrl, uploadedImageAsset.asset.url);
  assert.equal(publicView.data.deployment.config.leadFormEnabled, false);
  assert.equal(publicView.data.endpoints.publicPage, "/channels/wuhe-assistant");
  assert.equal(publicView.data.endpoints.publicMedia, "/api/public/channels/wuhe-assistant/media");
  assert.equal("companyContext" in publicView.data.workspace, false);
  assert.equal("persona" in publicView.data.person, false);
  assert.equal("profile" in publicView.data.person, false);

  await request(app.baseUrl, "/api/admin/people/wuhe-assistant", { method: "PUT", body: { profile: { ...personProfile, biography: "尚未发布的新简介" } } });
  const changedDraft = await request(app.baseUrl, "/api/admin/deployments/wuhe-miniapp-assistant/preview");
  assert.equal(changedDraft.data.deployment.config.biography, "尚未发布的新简介");
  const unchangedPublic = await request(app.baseUrl, "/api/public/channels/wuhe-assistant");
  assert.equal(unchangedPublic.data.deployment.config.biography, undefined);
  const publicPage = await fetch(`${app.baseUrl}${publicView.data.endpoints.publicPage}`);
  assert.equal(publicPage.status, 200);
  assert.match(publicPage.headers.get("content-type"), /text\/html/);
  assert.match(await publicPage.text(), /id="previewRoot"/);

  const mediaResponse = await fetch(`${app.baseUrl}${publicView.data.endpoints.publicMedia}`, {
    method: "POST",
    headers: { "content-type": "audio/webm", "x-file-name": encodeURIComponent("测试语音.webm") },
    body: new Uint8Array([26, 69, 223, 163])
  });
  assert.equal(mediaResponse.status, 201);
  const media = await mediaResponse.json();
  assert.equal(media.attachment.type, "audio");
  assert.equal(media.attachment.name, "测试语音.webm");

  const message = await request(app.baseUrl, publicView.data.endpoints.publicMessages, { method: "POST", body: {
    conversationId: "visitor-session-001",
    userId: "visitor-user-001",
    displayName: "语音访客",
    message: { id: "voice-message-001", type: "audio", text: "[语音消息 1 秒]", attachments: [media.attachment] }
  } });
  assert.equal(message.response.status, 202);
  assert.equal(message.data.items[0].handledBy, "agent");
  const outbox = await request(app.baseUrl, "/api/public/channels/wuhe-assistant/conversations/visitor-session-001/outbox?after=0");
  assert.equal(outbox.response.status, 200);
  assert.equal(outbox.data.items.length, 1);
  assert.match(outbox.data.items[0].content, /消息已收到/);

  const assistantMessage = await request(app.baseUrl, publicView.data.endpoints.assistantMessages, { method: "POST", body: {
    conversationId: "company-assistant-session-001",
    userId: "visitor-user-001",
    message: { id: "company-assistant-message-001", type: "audio", text: "[语音消息 1 秒]", attachments: [media.attachment] }
  } });
  assert.equal(assistantMessage.response.status, 202);
  const companyConversation = app.store.getConversation(assistantMessage.data.items[0].conversationId);
  const companyVoiceMessage = app.store.listMessages(companyConversation.id)[0];
  assert.equal(companyVoiceMessage.messageType, "audio");
  assert.equal(companyVoiceMessage.metadata.attachments[0].type, "audio");
  const assistantOutbox = await request(app.baseUrl, publicView.data.endpoints.assistantOutbox.replace("{conversationId}", "company-assistant-session-001"));
  assert.equal(assistantOutbox.response.status, 200);
  assert.match(assistantOutbox.data.items[0].content, /消息已收到/);
});

test("new people can be deployed to an existing website channel", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const person = await request(app.baseUrl, "/api/admin/workspaces/dingmai/people", { method: "POST", body: { id: "sales-li", name: "李明", title: "商务负责人", persona: { personality: "稳重" } } });
  assert.equal(person.response.status, 201);
  const deployment = await request(app.baseUrl, "/api/admin/workspaces/dingmai/deployments", { method: "POST", body: { id: "wuhe-web-li", workspaceChannelId: "wuhe-website", personId: "sales-li", publicSlug: "wuhe-li", sortOrder: 20, config: { welcomeMessage: "您好，我是李明" } } });
  assert.equal(deployment.response.status, 201);
  assert.equal(deployment.data.provider, "website");
  assert.equal(app.store.getAccount("wuhe-web-li").person.name, "李明");
  const preview = await request(app.baseUrl, "/api/admin/deployments/wuhe-web-li/preview");
  assert.equal(preview.data.deployments.length, 2);
  assert.deepEqual(preview.data.deployments.map((item) => item.person.name), ["向小顶", "李明"]);
});

test("one person shares flow and tag configuration across channel deployments", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const websiteMachine = app.store.getFlowMachine("website-default");
  websiteMachine.config.name = "跨渠道统一接待流程";
  app.store.saveFlowMachine("website-default", { enabled: true, config: websiteMachine.config });
  const miniappMachine = app.store.getFlowMachine("miniapp-default");
  assert.equal(miniappMachine.config.name, "跨渠道统一接待流程");
  assert.equal(miniappMachine.enabled, true);
  assert.equal(websiteMachine.configurationAccountId, "miniapp-default");

  app.store.saveTagSchema("website-default", { dateTag: { enabled: false }, groups: [{ id: "lead", name: "线索", tags: [{ id: "hot", name: "高意向", condition: "明确咨询", enabled: true }] }] });
  assert.equal(app.store.getTagSchema("miniapp-default").config.groups[0].tags[0].name, "高意向");
});

