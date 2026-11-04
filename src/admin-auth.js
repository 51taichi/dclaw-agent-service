import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "dclaw_admin_session";
const PASSWORD_MIN_LENGTH = 8;

export class AdminAuth {
  constructor({ store, platformPassword = "", required = false, sessionTtlHours = 12 } = {}) {
    this.store = store;
    this.platformPassword = String(platformPassword || "");
    this.required = Boolean(required);
    this.sessionTtlMs = Math.max(1, Number(sessionTtlHours) || 12) * 60 * 60 * 1000;
    this.failures = new Map();
    if (this.required && !this.platformPassword) throw new Error("启用后台登录后必须配置平台管理员密码");
  }

  session(req, requestedWorkspaceId = "") {
    if (!this.required) return { authenticated: true, authRequired: false, role: "platform", workspaceId: null };
    const token = cookieValue(req, COOKIE_NAME);
    const row = token ? this.store.getAdminSession(tokenHash(token)) : null;
    if (!row) return { authenticated: false, authRequired: true, role: null, workspaceId: requestedWorkspaceId || null };
    if (requestedWorkspaceId && row.scopeType === "workspace" && row.workspaceId !== requestedWorkspaceId) {
      return { authenticated: false, authRequired: true, role: null, workspaceId: requestedWorkspaceId };
    }
    return sessionView(row, true);
  }

  login(req, res, { workspaceId = "", password = "" } = {}) {
    if (!this.required) return { authenticated: true, authRequired: false, role: "platform", workspaceId: null };
    this.assertLoginAllowed(req);
    const normalizedWorkspaceId = String(workspaceId || "").trim();
    const suppliedPassword = String(password || "");
    let scopeType = "platform";
    let workspace = null;
    let valid = false;
    if (normalizedWorkspaceId) {
      scopeType = "workspace";
      workspace = this.store.getWorkspace(normalizedWorkspaceId);
      const hash = this.store.getWorkspacePasswordHash(normalizedWorkspaceId);
      valid = Boolean(workspace && hash && verifyPassword(suppliedPassword, hash));
    } else {
      valid = secureTextEqual(suppliedPassword, this.platformPassword);
    }
    if (!valid) {
      this.recordFailure(req);
      const error = new Error(normalizedWorkspaceId && workspace && !workspace.passwordConfigured
        ? "该工作区尚未配置登录密码，请联系平台管理员"
        : "登录密码不正确");
      error.status = 401;
      throw error;
    }
    this.clearFailures(req);
    const existingToken = cookieValue(req, COOKIE_NAME);
    if (existingToken) this.store.deleteAdminSession(tokenHash(existingToken));
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.sessionTtlMs).toISOString();
    this.store.createAdminSession({ tokenHash: tokenHash(token), scopeType, workspaceId: workspace?.id || null, expiresAt });
    setSessionCookie(req, res, token, this.sessionTtlMs);
    return {
      authenticated: true,
      authRequired: true,
      role: scopeType,
      workspaceId: workspace?.id || null,
      workspace: workspace ? workspaceSummary(workspace) : null,
      expiresAt
    };
  }

  logout(req, res) {
    const token = cookieValue(req, COOKIE_NAME);
    if (token) this.store.deleteAdminSession(tokenHash(token));
    clearSessionCookie(req, res);
  }

  requireSession(req, res, next) {
    const session = this.session(req);
    if (!session.authenticated) return res.status(401).json({ error: "请先登录管理后台", code: "ADMIN_LOGIN_REQUIRED" });
    req.adminSession = session;
    next();
  }

  setWorkspacePassword(workspaceId, password) {
    const normalized = this.validateWorkspacePassword(password);
    this.store.setWorkspacePasswordHash(workspaceId, hashPassword(normalized));
    this.store.deleteWorkspaceAdminSessions(workspaceId);
  }

  validateWorkspacePassword(password) {
    const normalized = String(password || "");
    if (normalized.length < PASSWORD_MIN_LENGTH) throw new TypeError(`工作区密码至少需要 ${PASSWORD_MIN_LENGTH} 位`);
    return normalized;
  }

  assertLoginAllowed(req) {
    const entry = this.failures.get(clientKey(req));
    if (!entry || entry.resetAt <= Date.now()) return;
    if (entry.count < 8) return;
    const error = new Error("登录尝试过于频繁，请稍后再试");
    error.status = 429;
    throw error;
  }

  recordFailure(req) {
    const key = clientKey(req);
    const existing = this.failures.get(key);
    const entry = !existing || existing.resetAt <= Date.now() ? { count: 0, resetAt: Date.now() + 15 * 60 * 1000 } : existing;
    entry.count += 1;
    this.failures.set(key, entry);
  }

  clearFailures(req) {
    this.failures.delete(clientKey(req));
  }
}

export function workspaceSummary(workspace) {
  return workspace ? { id: workspace.id, name: workspace.name, slug: workspace.slug, passwordConfigured: workspace.passwordConfigured } : null;
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

function verifyPassword(password, stored) {
  const [scheme, encodedSalt, encodedHash] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !encodedSalt || !encodedHash) return false;
  try {
    const expected = Buffer.from(encodedHash, "base64url");
    const actual = scryptSync(String(password || ""), Buffer.from(encodedSalt, "base64url"), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function secureTextEqual(left, right) {
  const leftHash = createHash("sha256").update(String(left || "")).digest();
  const rightHash = createHash("sha256").update(String(right || "")).digest();
  return timingSafeEqual(leftHash, rightHash) && Boolean(right);
}

function tokenHash(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function cookieValue(req, name) {
  const source = String(req.headers.cookie || "");
  for (const part of source.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ""; }
  }
  return "";
}

function setSessionCookie(req, res, token, maxAgeMs) {
  const secure = req.secure || String(req.headers["x-forwarded-proto"] || "").split(",", 1)[0].trim() === "https";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? "; Secure" : ""}`);
}

function clearSessionCookie(req, res) {
  const secure = req.secure || String(req.headers["x-forwarded-proto"] || "").split(",", 1)[0].trim() === "https";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
}

function sessionView(row, authRequired) {
  return {
    authenticated: true,
    authRequired,
    role: row.scopeType,
    workspaceId: row.workspaceId || null,
    workspace: row.workspaceId ? { id: row.workspaceId, name: row.workspaceName, slug: row.workspaceSlug } : null,
    expiresAt: row.expiresAt
  };
}

function clientKey(req) {
  return `${req.ip || req.socket?.remoteAddress || "unknown"}:${String(req.body?.workspaceId || "platform")}`;
}
