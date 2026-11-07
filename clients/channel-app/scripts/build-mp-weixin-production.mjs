import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appId = String(process.env.DCLAW_MINIAPP_APP_ID || "").trim();
const apiBase = String(process.env.DCLAW_MINIAPP_API_BASE || "https://agent.deepmega.cn").replace(/\/$/, "");
const projectName = String(process.env.DCLAW_MINIAPP_PROJECT_NAME || "DClaw智能名片").trim();

if (!/^wx[a-z0-9]{16}$/i.test(appId)) {
  console.error("请通过 DCLAW_MINIAPP_APP_ID 提供有效的小程序 AppID。");
  process.exit(1);
}

await runBuild({
  ...process.env,
  VITE_API_BASE: apiBase,
  VITE_DEFAULT_API_BASE: apiBase,
  VITE_MINIAPP_APP_ID: appId
});

const compileOutputRoot = path.join(projectRoot, "dist/build/mp-weixin");
const outputRoot = path.join(projectRoot, `dist/production/mp-weixin-${appId}`);
await rm(outputRoot, { recursive: true, force: true });
await cp(compileOutputRoot, outputRoot, { recursive: true });
const projectConfigPath = path.join(outputRoot, "project.config.json");
const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8"));
projectConfig.appid = appId;
projectConfig.projectname = projectName;
projectConfig.miniprogramRoot = "./";
await writeFile(projectConfigPath, `${JSON.stringify(projectConfig, null, 2)}\n`);
await writeFile(path.join(outputRoot, "project.private.config.json"), `${JSON.stringify({
  condition: {
    miniprogram: {
      current: 0,
      list: [{
        name: "工作区名片首页",
        pathName: "pages/home/index",
        query: "",
        scene: null,
        launchMode: "default"
      }]
    }
  }
}, null, 2)}\n`);

console.log(`生产包已生成：${outputRoot}`);
console.log(`AppID：${appId}`);
console.log(`API：${apiBase}`);

function runBuild(env) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ["run", "build:mp-weixin"], {
      cwd: projectRoot,
      env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) return reject(new Error(`构建被信号 ${signal} 中断`));
      if (code !== 0) return reject(new Error(`微信小程序构建失败（退出码 ${code}）`));
      resolve();
    });
  });
}
