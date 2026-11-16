import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "dclaw_admin_session";
const LEGACY_PREVIEW_COOKIE_NAME = "dclaw_preview_session";
const PREVIEW_COOKIE_PREFIX = "dclaw_preview_session_";
const PASSWORD_MIN_LENGTH = 8;
const PERMANENT_SESSION_EXPIRY = "9999-12-31T23:59:59.999Z";
const PERSISTENT_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const PREVIEW_LAUNCH_TICKET_TTL_MS = 2 * 60 * 1000;
const PREVIEW_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class AdminAuth {
  constructor({ store, platformPassword = "", required = false, sessionTtlHours = 0 } = {}) {
    this.store = store;
    this.platformPassword = String(platformPassword || "");
    this.required = Boolean(required);
    const ttlHours = Number(sessionTtlHours);
    this.sessionTtlMs = Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours * 60 * 60 * 1000 : 0;
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
    const expiresAt = this.sessionTtlMs ? new Date(Date.now() + this.sessionTtlMs).toISOString() : PERMANENT_SESSION_EXPIRY;
    this.store.createAdminSession({ tokenHash: tokenHash(token), scopeType, workspaceId: workspace?.id || null, expiresAt });
    setSessionCookie(req, res, token, this.sessionTtlMs || PERSISTENT_COOKIE_MAX_AGE_MS);
    return {
      authenticated: true,
      authRequired: true,
      role: scopeType,
      workspaceId: workspace?.id || null,
      workspace: workspace ? workspaceSummary(workspace) : null,
      expiresAt: this.sessionTtlMs ? expiresAt : null
    };
  }

  logout(req, res) {
    const token = cookieValue(req, COOKIE_NAME);
    if (token) this.store.deleteAdminSession(tokenHash(token));
    const previewCookies = cookieEntries(req).filter(([name]) => name === LEGACY_PREVIEW_COOKIE_NAME || name.startsWith(PREVIEW_COOKIE_PREFIX));
    for (const [, previewToken] of previewCookies) if (previewToken) this.store.deletePreviewSession(tokenHash(previewToken));
    clearSessionCookie(req, res);
    for (const [name] of previewCookies) clearPreviewCookie(req, res, name);
    if (!previewCookies.some(([name]) => name === LEGACY_PREVIEW_COOKIE_NAME)) clearPreviewCookie(req, res, LEGACY_PREVIEW_COOKIE_NAME);
  }

  requireSession(req, res, next) {
    const session = this.session(req);
    if (!session.authenticated) return res.status(401).json({ error: "请先登录管理后台", code: "ADMIN_LOGIN_REQUIRED" });
    req.adminSession = session;
    next();
  }

  issuePreviewLaunch(session, { deploymentId = "", channelId = "" } = {}) {
    const scope = deploymentId ? { type: "deployment", id: String(deploymentId) } : channelId ? { type: "channel", id: String(channelId) } : null;
    if (!session?.authenticated || !scope) throw unauthorized("预览权限无效");
    const resource = scope.type === "deployment" ? this.store.getDeployment(scope.id) : this.store.getWorkspaceChannel(scope.id);
    if (!resource) throw notFound("预览对象不存在");
    if (session.role === "workspace" && resource.workspaceId !== session.workspaceId) throw forbidden("无权预览其他工作区");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + PREVIEW_LAUNCH_TICKET_TTL_MS).toISOString();
    const launchPath = scope.type === "deployment"
      ? `/channels/${encodeURIComponent(resource.publicSlug)}?deployment=${encodeURIComponent(resource.id)}&preview=draft&t=${Date.now()}`
      : `/channels/channel-preview?channel=${encodeURIComponent(resource.id)}&preview=draft&t=${Date.now()}`;
    this.store.createPreviewLaunchTicket({
      tokenHash: tokenHash(token),
      workspaceId: resource.workspaceId,
      resourceType: scope.type,
      resourceId: scope.id,
      launchPath,
      expiresAt
    });
    return { token, expiresAt };
  }

  redeemPreviewLaunch(req, res, token) {
    const ticket = this.store.redeemPreviewLaunchTicket(tokenHash(token));
    if (!ticket) throw gone("预览启动链接已过期，请从管理后台重新打开");
    const previewToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + PREVIEW_SESSION_TTL_MS).toISOString();
    this.store.createPreviewSession({ tokenHash: tokenHash(previewToken), workspaceId: ticket.workspaceId, expiresAt });
    setPreviewCookie(req, res, previewCookieName(this.store.getWorkspace(ticket.workspaceId)), previewToken, PREVIEW_SESSION_TTL_MS);
    return { ...ticket, expiresAt };
  }

  authorizePreview(req) {
    const workspaceId = this.previewWorkspaceId(req.path);
    if (!workspaceId) return false;
    const cookieToken = cookieValue(req, previewCookieName(this.store.getWorkspace(workspaceId)));
    const session = cookieToken ? this.store.getPreviewSession(tokenHash(cookieToken)) : null;
    return Boolean(session && workspaceId === session.workspaceId);
  }

  setWorkspacePassword(workspaceId, password) {
    const normalized = this.validateWorkspacePassword(password);
    this.store.setWorkspacePasswordHash(workspaceId, hashPassword(normalized));
    this.store.deleteWorkspaceAdminSessions(workspaceId);
    this.store.deleteWorkspacePreviewAccess(workspaceId);
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

  previewWorkspaceId(pathname) {
    let match = String(pathname || "").match(/^\/api\/admin\/deployments\/([^/]+)\/preview(?:\/|$)/);
    if (match) {
      const deploymentId = decodePathSegment(match[1]);
      return deploymentId ? this.store.getDeployment(deploymentId)?.workspaceId || "" : "";
    }
    match = String(pathname || "").match(/^\/api\/admin\/channels\/([^/]+)\/preview$/);
    const channelId = match ? decodePathSegment(match[1]) : "";
    return channelId ? this.store.getWorkspaceChannel(channelId)?.workspaceId || "" : "";
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
  return cookieEntries(req).find(([entryName]) => entryName === name)?.[1] || "";
}

function cookieEntries(req) {
  const entries = [];
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    try { entries.push([part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]); } catch {}
  }
  return entries;
}

function previewCookieName(workspace) {
  const scope = String(workspace?.slug || workspace?.id || "preview").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
  return `${PREVIEW_COOKIE_PREFIX}${scope}`;
}

function setSessionCookie(req, res, token, maxAgeMs) {
  const secure = req.secure || String(req.headers["x-forwarded-proto"] || "").split(",", 1)[0].trim() === "https";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? "; Secure" : ""}`);
}

function clearSessionCookie(req, res) {
  const secure = req.secure || String(req.headers["x-forwarded-proto"] || "").split(",", 1)[0].trim() === "https";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
}

function setPreviewCookie(req, res, name, token, maxAgeMs) {
  const secure = req.secure || String(req.headers["x-forwarded-proto"] || "").split(",", 1)[0].trim() === "https";
  res.append("Set-Cookie", `${name}=${encodeURIComponent(token)}; Path=/api/admin; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? "; Secure" : ""}`);
}

function clearPreviewCookie(req, res, name) {
  const secure = req.secure || String(req.headers["x-forwarded-proto"] || "").split(",", 1)[0].trim() === "https";
  res.append("Set-Cookie", `${name}=; Path=/api/admin; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
}

function sessionView(row, authRequired) {
  return {
    authenticated: true,
    authRequired,
    role: row.scopeType,
    workspaceId: row.workspaceId || null,
    workspace: row.workspaceId ? { id: row.workspaceId, name: row.workspaceName, slug: row.workspaceSlug } : null,
    expiresAt: row.expiresAt === PERMANENT_SESSION_EXPIRY ? null : row.expiresAt
  };
}

function clientKey(req) {
  return `${req.ip || req.socket?.remoteAddress || "unknown"}:${String(req.body?.workspaceId || "platform")}`;
}

function decodePathSegment(value) {
  try { return decodeURIComponent(value); } catch { return ""; }
}

function unauthorized(message) {
  const error = new Error(message);
  error.status = 401;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function gone(message) {
  const error = new Error(message);
  error.status = 410;
  return error;
}
