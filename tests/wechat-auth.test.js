import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createApp } from "../src/app.js";

async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-wechat-auth-"));
  const fetchCalls = [];
  const context = createApp({
    databasePath: path.join(directory, "test.sqlite"),
    agentTimeoutMs: 5000,
    deliveryMaxAttempts: 1,
    wechatSessionTtlDays: 30,
    credentialEncryptionKey: "test-master-encryption-key"
  }, {
    fetchImpl: async (url) => {
      fetchCalls.push(String(url));
      return new Response(JSON.stringify({ openid: "openid-visitor-001", unionid: "unionid-001" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  context.services.workspaceMiniapps.save("dingmai", {
    mode: "dedicated",
    name: "伍合测试小程序",
    appId: "wx-test-app",
    appSecret: "wechat-test-secret"
  });
  const server = context.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    ...context,
    fetchCalls,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
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
  return { response, data: await response.json() };
}

test("wechat login persists a confirmed profile by openid and restores it", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const login = await jsonRequest(app.baseUrl, "/api/public/wechat/login", { method: "POST", body: { code: "login-code-001", publicSlug: "wuhe-assistant" } });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.profile.profileComplete, false);
  assert.ok(login.data.sessionToken);
  assert.match(app.fetchCalls[0], /appid=wx-test-app/);
  assert.match(app.fetchCalls[0], /js_code=login-code-001/);

  const saved = await jsonRequest(app.baseUrl, "/api/public/wechat/profile", {
    method: "PUT",
    headers: { authorization: `Bearer ${login.data.sessionToken}` },
    body: { nickName: "微信客户小王", avatarUrl: "http://127.0.0.1/media/avatar.jpg" }
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.profile.nickName, "微信客户小王");
  assert.equal(saved.data.profile.profileComplete, true);

  const restored = await jsonRequest(app.baseUrl, "/api/public/wechat/login", { method: "POST", body: { code: "login-code-002", publicSlug: "wuhe-assistant" } });
  assert.equal(restored.data.profile.nickName, "微信客户小王");
  assert.equal(restored.data.profile.avatarUrl, "http://127.0.0.1/media/avatar.jpg");
});

test("wechat profile update rejects an invalid session", async (t) => {
  const app = await fixture();
  t.after(() => app.close());
  const result = await jsonRequest(app.baseUrl, "/api/public/wechat/profile", {
    method: "PUT",
    headers: { authorization: "Bearer invalid-token" },
    body: { nickName: "无效客户" }
  });
  assert.equal(result.response.status, 401);
});

test("wechat identities and session tokens are isolated by workspace and app", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  app.store.createWorkspace({ id: "acme", slug: "acme", name: "Acme" });
  app.store.createPerson("acme", { id: "acme-agent", name: "Acme Agent" });
  app.store.createWorkspaceChannel("acme", { id: "acme-miniapp", provider: "miniapp", name: "Acme Mini Program" });
  app.store.createDeployment("acme", {
    id: "acme-card",
    workspaceChannelId: "acme-miniapp",
    personId: "acme-agent",
    publicSlug: "acme-card"
  });
  app.services.workspaceMiniapps.save("acme", {
    mode: "dedicated",
    name: "Acme Mini Program",
    appId: "wx-acme-app",
    appSecret: "acme-test-secret"
  });

  const wuheLogin = await jsonRequest(app.baseUrl, "/api/public/wechat/login", {
    method: "POST",
    body: { code: "wuhe-login-code", publicSlug: "wuhe-assistant" }
  });
  const acmeLogin = await jsonRequest(app.baseUrl, "/api/public/wechat/login", {
    method: "POST",
    body: { code: "acme-login-code", publicSlug: "acme-card" }
  });
  assert.equal(wuheLogin.response.status, 200);
  assert.equal(acmeLogin.response.status, 200);

  await jsonRequest(app.baseUrl, "/api/public/wechat/profile", {
    method: "PUT",
    headers: { authorization: `Bearer ${wuheLogin.data.sessionToken}` },
    body: { nickName: "伍合访客" }
  });
  await jsonRequest(app.baseUrl, "/api/public/wechat/profile", {
    method: "PUT",
    headers: { authorization: `Bearer ${acmeLogin.data.sessionToken}` },
    body: { nickName: "Acme Visitor" }
  });

  assert.equal(app.store.getWechatVisitor("dingmai", "wx-test-app", "openid-visitor-001").nickName, "伍合访客");
  assert.equal(app.store.getWechatVisitor("acme", "wx-acme-app", "openid-visitor-001").nickName, "Acme Visitor");

  const [payload, signature] = wuheLogin.data.sessionToken.split(".");
  const forgedScope = {
    ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    workspaceId: "acme",
    appId: "wx-acme-app"
  };
  const forgedToken = `${Buffer.from(JSON.stringify(forgedScope)).toString("base64url")}.${signature}`;
  const forgedUpdate = await jsonRequest(app.baseUrl, "/api/public/wechat/profile", {
    method: "PUT",
    headers: { authorization: `Bearer ${forgedToken}` },
    body: { nickName: "越权访客" }
  });
  assert.equal(forgedUpdate.response.status, 401);
  assert.equal(app.store.getWechatVisitor("acme", "wx-acme-app", "openid-visitor-001").nickName, "Acme Visitor");
});
