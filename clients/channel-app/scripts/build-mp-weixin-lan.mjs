import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const preferredHost = String(process.env.DCLAW_LAN_HOST || "").trim();
const host = preferredHost || Object.values(networkInterfaces())
  .flat()
  .find((address) => address?.family === "IPv4" && !address.internal)?.address;

if (!host) {
  console.error("未找到局域网 IPv4 地址，请设置 DCLAW_LAN_HOST 后重试。");
  process.exit(1);
}

const port = String(process.env.DCLAW_AGENT_PORT || "4313").trim();
const apiBase = `http://${host}:${port}`;
console.log(`微信真机 API 地址：${apiBase}`);

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npmCommand, ["run", "build:mp-weixin"], {
  stdio: "inherit",
  env: { ...process.env, VITE_API_BASE: apiBase }
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
