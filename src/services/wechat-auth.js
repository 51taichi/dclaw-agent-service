import { createHmac, timingSafeEqual } from "node:crypto";

export class WechatAuth {
  constructor({ appId = "", appSecret = "", sessionTtlDays = 30, fetchImpl = globalThis.fetch, tokenScope = {} } = {}) {
    this.appId = String(appId || "").trim();
    this.appSecret = String(appSecret || "").trim();
    this.sessionTtlDays = Math.max(1, Number(sessionTtlDays) || 30);
    this.fetchImpl = fetchImpl;
    this.tokenScope = tokenScope;
  }

  isConfigured() {
    return Boolean(this.appId && this.appSecret);
  }

  async exchangeCode(code) {
    if (!this.isConfigured()) throw httpError(503, "微信小程序登录尚未配置");
    const normalizedCode = String(code || "").trim();
    if (!/^[A-Za-z0-9_-]{4,256}$/.test(normalizedCode)) throw httpError(400, "微信登录凭证无效");

    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.search = new URLSearchParams({
      appid: this.appId,
      secret: this.appSecret,
      js_code: normalizedCode,
      grant_type: "authorization_code"
    }).toString();
    const response = await this.fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw httpError(502, "微信登录服务暂时不可用");
    const result = await response.json();
    if (!result?.openid) throw httpError(401, `微信登录失败${result?.errmsg ? `：${result.errmsg}` : ""}`);
    return { openid: String(result.openid), unionid: String(result.unionid || "") };
  }

  issueToken(openid) {
    const payload = Buffer.from(JSON.stringify({
      sub: String(openid),
      workspaceId: String(this.tokenScope.workspaceId || ""),
      appId: String(this.tokenScope.appId || this.appId),
      exp: Math.floor(Date.now() / 1000) + this.sessionTtlDays * 24 * 60 * 60
    })).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  verifyAuthorization(value) {
    if (!this.isConfigured()) throw httpError(503, "微信小程序登录尚未配置");
    const token = String(value || "").replace(/^Bearer\s+/i, "").trim();
    const [payload, suppliedSignature, extra] = token.split(".");
    if (!payload || !suppliedSignature || extra) throw httpError(401, "微信登录状态无效");
    const expectedSignature = this.sign(payload);
    const expected = Buffer.from(expectedSignature);
    const supplied = Buffer.from(suppliedSignature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw httpError(401, "微信登录状态无效");
    let parsed;
    try { parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
    catch { throw httpError(401, "微信登录状态无效"); }
    if (!parsed?.sub || !Number.isFinite(parsed.exp) || parsed.exp <= Math.floor(Date.now() / 1000)) throw httpError(401, "微信登录状态已过期");
    if (!parsed.workspaceId || !parsed.appId) throw httpError(401, "微信登录状态无效");
    return { openid: String(parsed.sub), workspaceId: String(parsed.workspaceId), appId: String(parsed.appId) };
  }

  static peekScope(value) {
    const token = String(value || "").replace(/^Bearer\s+/i, "").trim();
    const [payload] = token.split(".");
    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (!parsed?.workspaceId || !parsed?.appId) throw new Error();
      return { workspaceId: String(parsed.workspaceId), appId: String(parsed.appId) };
    } catch {
      throw httpError(401, "微信登录状态无效");
    }
  }

  sign(payload) {
    return createHmac("sha256", this.appSecret).update(payload).digest("base64url");
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
