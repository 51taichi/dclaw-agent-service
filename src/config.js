import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig(env = process.env) {
  return Object.freeze({
    projectRoot,
    host: env.HOST || "127.0.0.1",
    port: positiveInteger(env.PORT, 4310),
    databasePath: path.resolve(projectRoot, env.DATABASE_PATH || "data/dclaw-agent.sqlite"),
    publicBaseUrl: env.PUBLIC_BASE_URL || "http://127.0.0.1:4310",
    agentTimeoutMs: positiveInteger(env.AGENT_TIMEOUT_MS, 90_000),
    deliveryMaxAttempts: positiveInteger(env.DELIVERY_MAX_ATTEMPTS, 3),
    speechApiUrl: env.SPEECH_API_URL || "",
    speechApiKey: env.SPEECH_API_KEY || "",
    speechModel: env.SPEECH_MODEL || "",
    speechLanguage: env.SPEECH_LANGUAGE || "zh",
    speechTimeoutMs: positiveInteger(env.SPEECH_TIMEOUT_MS, 60_000),
    wechatMiniappAppId: env.WECHAT_MINIAPP_APP_ID || "",
    wechatMiniappAppSecret: env.WECHAT_MINIAPP_APP_SECRET || "",
    wechatSessionTtlDays: positiveInteger(env.WECHAT_SESSION_TTL_DAYS, 30),
    credentialEncryptionKey: env.CREDENTIAL_ENCRYPTION_KEY || ""
  });
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
