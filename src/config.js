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
    deliveryMaxAttempts: positiveInteger(env.DELIVERY_MAX_ATTEMPTS, 3)
  });
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
