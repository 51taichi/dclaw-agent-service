import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { once } from "node:events";
import { createApp } from "../src/app.js";

async function fixture(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-admin-auth-"));
  const context = createApp({
    databasePath: path.join(directory, "test.sqlite"),
    agentTimeoutMs: 5000,
    deliveryMaxAttempts: 1,
    credentialEncryptionKey: "admin-auth-test-key",
    wechatSessionTtlDays: 30,
    adminAuthRequired: true,
    platformAdminPassword: "platform-password",
    adminSessionTtlHours: 12,
    ...overrides
  });
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

async function request(app, pathname, { cookie = "", ...options } = {}) {
  const response = await fetch(`${app.baseUrl}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...options.headers },
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const contentType = response.headers.get("content-type") || "";
  const data = response.status === 204 || !contentType.includes("application/json") ? null : await response.json();
  const setCookie = response.headers.get("set-cookie") || "";
  return { response, data, cookie: setCookie.split(";", 1)[0] || "", setCookie };
}

test("admin authentication separates platform and workspace permissions", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const anonymous = await request(app, "/api/admin/workspaces");
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.data.error, "请先登录管理后台");

  const target = await request(app, "/api/admin/auth/session?workspace=dingmai");
  assert.equal(target.response.status, 200);
  assert.equal(target.data.authenticated, false);
  assert.equal(target.data.targetWorkspace.id, "dingmai");

  const badLogin = await request(app, "/api/admin/auth/login", { method: "POST", body: { password: "wrong-password" } });
  assert.equal(badLogin.response.status, 401);

  const platformLogin = await request(app, "/api/admin/auth/login", { method: "POST", body: { password: "platform-password" } });
  assert.equal(platformLogin.response.status, 200);
  assert.equal(platformLogin.data.role, "platform");
  assert.match(platformLogin.cookie, /^dclaw_admin_session=/);

  const configured = await request(app, "/api/admin/workspaces/dingmai", {
    method: "PUT",
    cookie: platformLogin.cookie,
    body: { adminPassword: "dingmai-password" }
  });
  assert.equal(configured.response.status, 200);
  assert.equal(configured.data.passwordConfigured, true);
  assert.equal(JSON.stringify(configured.data).includes("dingmai-password"), false);

  const created = await request(app, "/api/admin/workspaces", {
    method: "POST",
    cookie: platformLogin.cookie,
    body: { id: "deepmega", slug: "deepmega", name: "DeepMega", adminPassword: "deepmega-password" }
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.data.passwordConfigured, true);
  assert.equal(JSON.stringify(created.data).includes("admin_password_hash"), false);

  const platformWorkspaces = await request(app, "/api/admin/workspaces", { cookie: platformLogin.cookie });
  assert.deepEqual(new Set(platformWorkspaces.data.items.map((item) => item.id)), new Set(["dingmai", "deepmega"]));

  const workspaceLogin = await request(app, "/api/admin/auth/login", {
    method: "POST",
    body: { workspaceId: "dingmai", password: "dingmai-password" }
  });
  assert.equal(workspaceLogin.response.status, 200);
  assert.equal(workspaceLogin.data.role, "workspace");
  assert.equal(workspaceLogin.data.workspaceId, "dingmai");

  const ownWorkspaces = await request(app, "/api/admin/workspaces", { cookie: workspaceLogin.cookie });
  assert.deepEqual(ownWorkspaces.data.items.map((item) => item.id), ["dingmai"]);

  const ownChannels = await request(app, "/api/admin/workspaces/dingmai/channels", { cookie: workspaceLogin.cookie });
  assert.equal(ownChannels.response.status, 200);
  const otherWorkspace = await request(app, "/api/admin/workspaces/deepmega/channels", { cookie: workspaceLogin.cookie });
  assert.equal(otherWorkspace.response.status, 403);

  const agentCatalog = await request(app, "/api/admin/agents", { cookie: workspaceLogin.cookie });
  assert.equal(agentCatalog.response.status, 200);
  const mutateAgent = await request(app, "/api/admin/agents/platform-default", {
    method: "PUT",
    cookie: workspaceLogin.cookie,
    body: { name: "越权修改" }
  });
  assert.equal(mutateAgent.response.status, 403);

  const ownAccounts = await request(app, "/api/accounts", { cookie: workspaceLogin.cookie });
  assert.ok(ownAccounts.data.items.length > 0);
  assert.ok(ownAccounts.data.items.every((item) => item.workspaceId === "dingmai"));

  const changedPassword = await request(app, "/api/admin/workspaces/dingmai", {
    method: "PUT",
    cookie: platformLogin.cookie,
    body: { adminPassword: "new-dingmai-password" }
  });
  assert.equal(changedPassword.response.status, 200);
  const invalidatedSession = await request(app, "/api/admin/workspaces", { cookie: workspaceLogin.cookie });
  assert.equal(invalidatedSession.response.status, 401);

  const relogin = await request(app, "/api/admin/auth/login", {
    method: "POST",
    body: { workspaceId: "dingmai", password: "new-dingmai-password" }
  });
  const logout = await request(app, "/api/admin/auth/logout", { method: "POST", cookie: relogin.cookie });
  assert.equal(logout.response.status, 204);
  const afterLogout = await request(app, "/api/admin/workspaces", { cookie: relogin.cookie });
  assert.equal(afterLogout.response.status, 401);
});

test("expired admin sessions are rejected and removed", async (t) => {
  const app = await fixture();
  t.after(() => app.close());
  const login = await request(app, "/api/admin/auth/login", { method: "POST", body: { password: "platform-password" } });
  app.db.prepare("UPDATE admin_sessions SET expires_at = ?").run("2000-01-01T00:00:00.000Z");
  const session = await request(app, "/api/admin/auth/session", { cookie: login.cookie });
  assert.equal(session.data.authenticated, false);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM admin_sessions").get().count, 0);
});

test("admin sessions can remain valid without an hourly expiry", async (t) => {
  const app = await fixture({ adminSessionTtlHours: 0 });
  t.after(() => app.close());
  const login = await request(app, "/api/admin/auth/login", { method: "POST", body: { password: "platform-password" } });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.expiresAt, null);
  assert.match(login.setCookie, /Max-Age=34560000/);
  assert.equal(app.db.prepare("SELECT expires_at AS expiresAt FROM admin_sessions").get().expiresAt, "9999-12-31T23:59:59.999Z");
  const session = await request(app, "/api/admin/auth/session", { cookie: login.cookie });
  assert.equal(session.data.authenticated, true);
  assert.equal(session.data.expiresAt, null);
});

test("preview launch URLs mirror the reusable handoff and long browser session", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const login = await request(app, "/api/admin/auth/login", { method: "POST", body: { password: "platform-password" } });
  const issued = await request(app, "/api/admin/deployments/dingmai-website-assistant/preview-launch", {
    method: "POST",
    cookie: login.cookie
  });
  assert.equal(issued.response.status, 200);
  assert.equal(issued.response.headers.get("cache-control"), "no-store");
  const launchUrl = new URL(issued.data.launchUrl);
  assert.match(launchUrl.pathname, /^\/api\/preview-launch\/[A-Za-z0-9_-]{43}$/);
  assert.equal(launchUrl.search, "");

  const exchanged = await request(app, launchUrl.pathname, { redirect: "manual" });
  assert.equal(exchanged.response.status, 303);
  assert.match(exchanged.response.headers.get("location"), /^\/channels\/dingmai-assistant-web\?deployment=dingmai-website-assistant&preview=draft&t=\d+$/);
  assert.equal(exchanged.response.headers.get("referrer-policy"), "no-referrer");
  assert.match(exchanged.cookie, /^dclaw_preview_session_dingmai=/);
  assert.match(exchanged.setCookie, /Path=\/api\/admin/);
  assert.match(exchanged.setCookie, /HttpOnly/);
  assert.match(exchanged.setCookie, /Max-Age=2592000/);

  const reused = await request(app, launchUrl.pathname, { redirect: "manual" });
  assert.equal(reused.response.status, 303);
  assert.match(reused.cookie, /^dclaw_preview_session_dingmai=/);
  assert.notEqual(reused.cookie, exchanged.cookie);

  const sameDeployment = await request(app, "/api/admin/deployments/dingmai-website-assistant/preview", { cookie: exchanged.cookie });
  assert.equal(sameDeployment.response.status, 200);
  const sameWorkspaceDeployment = await request(app, "/api/admin/deployments/dingmai-miniapp-assistant/preview", { cookie: exchanged.cookie });
  assert.equal(sameWorkspaceDeployment.response.status, 200);

  app.store.createWorkspace({ id: "other-workspace", slug: "other-workspace", name: "其他工作区" });
  app.store.createWorkspaceChannel("other-workspace", { id: "other-website", provider: "website", name: "其他官网" });
  const otherWorkspace = await request(app, "/api/admin/channels/other-website/preview", { cookie: exchanged.cookie });
  assert.equal(otherWorkspace.response.status, 401);
  const generalAdminApi = await request(app, "/api/admin/workspaces", { cookie: exchanged.cookie });
  assert.equal(generalAdminApi.response.status, 401);

  app.db.prepare("UPDATE preview_launch_tickets SET expires_at = ?").run("2000-01-01T00:00:00.000Z");
  const expired = await request(app, launchUrl.pathname, { redirect: "manual" });
  assert.equal(expired.response.status, 410);
});

test("channel preview launch redirects establish the same workspace session", async (t) => {
  const app = await fixture();
  t.after(() => app.close());

  const login = await request(app, "/api/admin/auth/login", { method: "POST", body: { password: "platform-password" } });
  const issued = await request(app, "/api/admin/channels/dingmai-website/preview-launch", { method: "POST", cookie: login.cookie });
  const launchPath = new URL(issued.data.launchUrl).pathname;
  const exchanged = await request(app, launchPath, { redirect: "manual" });
  assert.equal(exchanged.response.status, 303);
  assert.match(exchanged.response.headers.get("location"), /^\/channels\/channel-preview\?channel=dingmai-website&preview=draft&t=\d+$/);
  const deploymentPreview = await request(app, "/api/admin/deployments/dingmai-website-assistant/preview", { cookie: exchanged.cookie });
  assert.equal(deploymentPreview.response.status, 200);
  const sameWorkspaceChannel = await request(app, "/api/admin/channels/dingmai-miniapp/preview", { cookie: exchanged.cookie });
  assert.equal(sameWorkspaceChannel.response.status, 200);
});
