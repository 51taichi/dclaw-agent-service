import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { once } from "node:events";
import { createApp } from "../src/app.js";

async function fixture(fetchImpl = globalThis.fetch) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-agent-admin-"));
  const context = createApp({ databasePath: path.join(directory, "test.sqlite"), agentTimeoutMs: 5000, deliveryMaxAttempts: 1 }, { fetchImpl });
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
  assert.equal(workspaces.data.items[0].name, "伍合 AIGC");
  assert.equal(workspaces.data.items[0].personCount, 1);
  assert.equal(workspaces.data.items[0].channelCount, 2);

  const accounts = await request(app.baseUrl, "/api/accounts?workspace=wuhe");
  assert.deepEqual(new Set(accounts.data.items.map((item) => item.provider)), new Set(["website", "miniapp"]));
  assert.equal(accounts.data.items.some((item) => item.id === "fake-demo"), false);
  assert.ok(accounts.data.items.every((item) => item.person?.name === "伍合智能顾问"));
});

test("Agent binding resolves person then workspace then platform without copying credentials", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  await request(app.baseUrl, "/api/admin/agent-bindings/platform/default", { method: "PUT", body: { name: "平台", agentApiUrl: "https://platform.test/chat", agentApiKey: "platform-key", agentId: "platform-agent" } });
  let account = app.store.getAccount("miniapp-default", { includeSecrets: true });
  assert.equal(account.agentBinding.inheritedFrom, "platform");
  assert.equal(account.agentApiKey, "platform-key");

  await request(app.baseUrl, "/api/admin/agent-bindings/workspace/wuhe", { method: "PUT", body: { name: "工作区", agentApiUrl: "https://workspace.test/chat", agentApiKey: "workspace-key", agentId: "workspace-agent" } });
  account = app.store.getAccount("miniapp-default", { includeSecrets: true });
  assert.equal(account.agentBinding.inheritedFrom, "workspace");

  await request(app.baseUrl, "/api/admin/agent-bindings/person/wuhe-assistant", { method: "PUT", body: { name: "人物", agentApiUrl: "https://person.test/chat", agentApiKey: "person-key", agentId: "person-agent", billingLabel: "person-bill" } });
  account = app.store.getAccount("miniapp-default", { includeSecrets: true });
  assert.equal(account.agentBinding.inheritedFrom, "person");
  assert.equal(account.agentId, "person-agent");
  assert.equal(account.agentBinding.billingLabel, "person-bill");

  const publicAccount = await request(app.baseUrl, "/api/accounts/miniapp-default");
  assert.equal(publicAccount.data.agentApiKey, "••••••••");
});

test("channel draft is private until publish and preview is schema-versioned", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const draft = await request(app.baseUrl, "/api/admin/deployments/wuhe-miniapp-assistant/preview");
  assert.equal(draft.data.channelType, "miniapp");
  assert.equal(draft.data.schemaVersion, 1);
  assert.equal(draft.data.person.name, "伍合智能顾问");
  assert.equal(draft.data.deployment.config.leadForm.enabled, true);

  const unavailable = await request(app.baseUrl, "/api/public/channels/wuhe-assistant");
  assert.equal(unavailable.response.status, 404);

  const published = await request(app.baseUrl, "/api/admin/channels/wuhe-miniapp/publish", { method: "POST" });
  assert.equal(published.data.publishedVersion, 1);
  const publicView = await request(app.baseUrl, "/api/public/channels/wuhe-assistant");
  assert.equal(publicView.response.status, 200);
  assert.equal(publicView.data.mode, "published");
  assert.equal("companyContext" in publicView.data.workspace, false);
  assert.equal("persona" in publicView.data.person, false);
});

test("new people can be deployed to an existing website channel", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const person = await request(app.baseUrl, "/api/admin/workspaces/wuhe/people", { method: "POST", body: { id: "sales-li", name: "李顾问", title: "商务顾问", persona: { personality: "稳重" } } });
  assert.equal(person.response.status, 201);
  const deployment = await request(app.baseUrl, "/api/admin/workspaces/wuhe/deployments", { method: "POST", body: { id: "wuhe-web-li", workspaceChannelId: "wuhe-website", personId: "sales-li", publicSlug: "wuhe-li", config: { welcomeMessage: "您好，我是李顾问" } } });
  assert.equal(deployment.response.status, 201);
  assert.equal(deployment.data.provider, "website");
  assert.equal(app.store.getAccount("wuhe-web-li").person.name, "李顾问");
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

