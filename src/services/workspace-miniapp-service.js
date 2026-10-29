import { WechatAuth } from "./wechat-auth.js";

export class WorkspaceMiniappService {
  constructor({ store, vault, fetchImpl = globalThis.fetch, sessionTtlDays = 30 } = {}) {
    this.store = store;
    this.vault = vault;
    this.fetchImpl = fetchImpl;
    this.sessionTtlDays = sessionTtlDays;
  }

  get(workspaceId) {
    return this.store.getWorkspaceMiniapp(workspaceId);
  }

  save(workspaceId, input) {
    if (!this.store.getWorkspace(workspaceId)) return null;
    const existing = this.store.getWorkspaceMiniapp(workspaceId, { includeSecrets: true });
    const suppliedSecret = input?.appSecret === undefined || input.appSecret === "••••••••" ? "" : String(input.appSecret || "").trim();
    const appId = String(input?.appId || "").trim();
    const credentialsChanged = !existing || existing.appId !== appId || Boolean(suppliedSecret);
    let encryptedSecret = existing?.encryptedAppSecret || "";
    if (suppliedSecret) encryptedSecret = this.vault.encrypt(suppliedSecret);
    if (!encryptedSecret) throw typeError("请配置小程序 AppSecret");
    return this.store.saveWorkspaceMiniapp(workspaceId, {
      mode: input?.mode,
      name: input?.name,
      appId,
      encryptedAppSecret: encryptedSecret,
      originalId: input?.originalId,
      status: !credentialsChanged && existing?.verifiedAt ? "verified" : "configured",
      verifiedAt: credentialsChanged ? null : existing?.verifiedAt
    });
  }

  async verify(workspaceId) {
    const config = this.requirePrivateConfig(workspaceId);
    const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
    url.search = new URLSearchParams({ grant_type: "client_credential", appid: config.appId, secret: config.appSecret }).toString();
    const response = await this.fetchImpl(url, { headers: { Accept: "application/json" } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.access_token) {
      const error = new Error(`微信小程序配置验证失败${result?.errmsg ? `：${result.errmsg}` : ""}`);
      error.status = 400;
      throw error;
    }
    return this.store.markWorkspaceMiniappVerified(workspaceId);
  }

  async login({ publicSlug = "", deploymentId = "", code = "" } = {}) {
    const scope = this.store.resolveMiniappWorkspace({ publicSlug, deploymentId });
    if (!scope) {
      const error = new Error("智能名片不存在或未开通");
      error.status = 404;
      throw error;
    }
    const config = this.requirePrivateConfig(scope.workspaceId);
    const auth = new WechatAuth({
      appId: config.appId,
      appSecret: config.appSecret,
      sessionTtlDays: this.sessionTtlDays,
      fetchImpl: this.fetchImpl,
      tokenScope: { workspaceId: scope.workspaceId, appId: config.appId }
    });
    const identity = await auth.exchangeCode(code);
    const profile = this.store.ensureWechatVisitor(scope.workspaceId, config.appId, identity.openid, identity.unionid);
    return { sessionToken: auth.issueToken(identity.openid), profile };
  }

  saveProfile(authorization, input) {
    const tokenScope = WechatAuth.peekScope(authorization);
    const config = this.requirePrivateConfig(tokenScope.workspaceId);
    if (config.appId !== tokenScope.appId) throw unauthorized("微信登录状态与当前小程序不匹配");
    const auth = new WechatAuth({
      appId: config.appId,
      appSecret: config.appSecret,
      sessionTtlDays: this.sessionTtlDays,
      fetchImpl: this.fetchImpl,
      tokenScope: { workspaceId: tokenScope.workspaceId, appId: config.appId }
    });
    const identity = auth.verifyAuthorization(authorization);
    return this.store.saveWechatVisitorProfile(identity.workspaceId, identity.appId, identity.openid, input);
  }

  requirePrivateConfig(workspaceId) {
    const config = this.store.getWorkspaceMiniapp(workspaceId, { includeSecrets: true });
    if (!config?.encryptedAppSecret) {
      const error = new Error("当前公司的微信小程序尚未配置");
      error.status = 503;
      throw error;
    }
    return { ...config, appSecret: this.vault.decrypt(config.encryptedAppSecret) };
  }
}

function typeError(message) {
  return new TypeError(message);
}

function unauthorized(message) {
  const error = new Error(message);
  error.status = 401;
  return error;
}
