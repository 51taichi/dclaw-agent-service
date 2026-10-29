import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/database.js";
import { Store } from "../src/repositories/store.js";
import { CredentialVault } from "../src/services/credential-vault.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const workspaceId = String(process.argv[2] || "dingmai").trim();
const appId = String(process.env.WECHAT_MINIAPP_APP_ID || "").trim();
const appSecret = String(process.env.WECHAT_MINIAPP_APP_SECRET || "").trim();
if (!appId || !appSecret) throw new Error(".env 中没有可迁移的微信小程序 AppID/AppSecret");

const encryptionKey = String(process.env.CREDENTIAL_ENCRYPTION_KEY || "").trim() || randomBytes(32).toString("base64url");
process.env.CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);
try {
  const store = new Store(db);
  const workspace = store.getWorkspace(workspaceId);
  if (!workspace) throw new Error(`工作区不存在：${workspaceId}`);
  const vault = new CredentialVault(encryptionKey);
  store.saveWorkspaceMiniapp(workspaceId, {
    mode: "dedicated",
    name: `${workspace.name}小程序`,
    appId,
    encryptedAppSecret: vault.encrypt(appSecret),
    status: "configured"
  });

  let envSource = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  envSource = setEnvValue(envSource, "CREDENTIAL_ENCRYPTION_KEY", encryptionKey);
  envSource = setEnvValue(envSource, "WECHAT_MINIAPP_APP_ID", "");
  envSource = setEnvValue(envSource, "WECHAT_MINIAPP_APP_SECRET", "");
  fs.writeFileSync(envPath, envSource, { mode: 0o600 });
  console.log(`微信小程序配置已迁移到工作区 ${workspaceId}，旧的全局 AppID/AppSecret 已清空。`);
} finally {
  db.close();
}

function setEnvValue(source, key, value) {
  const line = `${key}=${value}`;
  const expression = new RegExp(`^${key}=.*$`, "m");
  if (expression.test(source)) return source.replace(expression, line);
  return `${source.replace(/\s*$/, "")}\n${line}\n`;
}
