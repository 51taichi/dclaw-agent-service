const PLATFORM = process.env.UNI_PLATFORM || "h5";
const configuredBase = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
export const API_BASE = configuredBase || (PLATFORM === "mp-weixin" ? "http://127.0.0.1:4313" : "");
const bundledMiniappImages = {
  "/console/assets/bot-avatar.png": "/static/brand/bot-avatar.png",
  "/console/assets/ddeer.png": "/static/brand/ddeer.png",
  "/console/assets/contact-qr-demo.svg": "/static/brand/contact-qr-demo.png",
  "/console/assets/contact-qr-demo.png": "/static/brand/contact-qr-demo.png"
};
const preparedImageCache = new Map();

export function resolveAssetUrl(value) {
  const url = String(value || "").trim();
  const bundled = PLATFORM === "mp-weixin" ? bundledMiniappImages[assetPathname(url)] : "";
  if (bundled) return bundled;
  if (!url || /^(https?:|data:|blob:)/i.test(url)) return url;
  return `${API_BASE}${url.startsWith("/") ? url : `/${url}`}`;
}

export function prepareImageAsset(value) {
  const resolved = resolveAssetUrl(value);
  if (PLATFORM !== "mp-weixin" || !/^https?:/i.test(resolved)) return Promise.resolve(resolved);
  if (preparedImageCache.has(resolved)) return preparedImageCache.get(resolved);
  const pending = cacheRemoteImage(resolved).catch(() => resolved);
  preparedImageCache.set(resolved, pending);
  return pending;
}

export function request(path, { method = "GET", data, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: resolveAssetUrl(path),
      method,
      data,
      header: { "Content-Type": "application/json", ...headers },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
        else reject(new Error(response.data?.error || `请求失败（${response.statusCode}）`));
      },
      fail(error) {
        reject(new Error(error.errMsg || "网络连接失败"));
      }
    });
  });
}

function readLocalFile(filePath) {
  return new Promise((resolve, reject) => {
    if (typeof uni.getFileSystemManager === "function") {
      uni.getFileSystemManager().readFile({
        filePath,
        success(result) { resolve(result.data); },
        fail(error) { reject(new Error(error.errMsg || "录音文件读取失败")); }
      });
      return;
    }
    fetch(filePath).then((response) => {
      if (!response.ok) throw new Error("录音文件读取失败");
      return response.arrayBuffer();
    }).then(resolve, reject);
  });
}

function assetPathname(value) {
  if (!value) return "";
  if (value.startsWith("/")) return value.split(/[?#]/, 1)[0];
  try { return new URL(value).pathname; } catch { return value.split(/[?#]/, 1)[0]; }
}

function cacheRemoteImage(url) {
  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: "GET",
      responseType: "arraybuffer",
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300 || !response.data) return reject(new Error("图片下载失败"));
        const mimeType = String(response.header?.["content-type"] || response.header?.["Content-Type"] || "").split(";", 1)[0].toLowerCase();
        persistImage(response.data, url, mimeType).then(resolve, reject);
      },
      fail(error) { reject(new Error(error.errMsg || "图片下载失败")); }
    });
  });
}

function persistImage(data, url, mimeType) {
  const weixin = typeof wx === "undefined" ? null : wx;
  const userDataPath = weixin?.env?.USER_DATA_PATH || uni.env?.USER_DATA_PATH;
  if (!userDataPath || typeof uni.getFileSystemManager !== "function") return Promise.resolve(url);
  const extension = imageExtension(url, mimeType);
  const filePath = `${userDataPath}/dclaw-image-${stringHash(url)}.${extension}`;
  const fileSystem = uni.getFileSystemManager();
  return new Promise((resolve, reject) => {
    fileSystem.access({
      path: filePath,
      success() { resolve(filePath); },
      fail() {
        fileSystem.writeFile({ filePath, data, success: () => resolve(filePath), fail: (error) => reject(new Error(error.errMsg || "图片缓存失败")) });
      }
    });
  });
}

function imageExtension(url, mimeType) {
  const byMime = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[mimeType];
  if (byMime) return byMime;
  const matched = assetPathname(url).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return ["png", "jpg", "jpeg", "webp", "gif"].includes(matched) ? matched.replace("jpeg", "jpg") : "png";
}

function stringHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
}

export async function uploadBinary(path, { filePath, name, mimeType }) {
  if (!path || !filePath) throw new Error("录音上传地址不可用");
  const data = await readLocalFile(filePath);
  return request(path, {
    method: "POST",
    data,
    headers: {
      "Content-Type": mimeType || "application/octet-stream",
      "X-File-Name": encodeURIComponent(name || "voice.mp3")
    }
  });
}

export function persistentId(key) {
  const existing = uni.getStorageSync(key);
  if (existing) return existing;
  const value = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  uni.setStorageSync(key, value);
  return value;
}

export function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function showToast(title) {
  uni.showToast({ title: String(title || "操作失败"), icon: "none", duration: 2200 });
}

export function copyText(value) {
  return new Promise((resolve, reject) => {
    uni.setClipboardData({ data: String(value || ""), success: resolve, fail: reject });
  });
}

export function previewImage(url) {
  const resolved = resolveAssetUrl(url);
  if (resolved) uni.previewImage({ current: resolved, urls: [resolved] });
}

function readRecordPermission() {
  return new Promise((resolve) => {
    if (typeof uni.getSetting !== "function") return resolve(undefined);
    uni.getSetting({
      success(result) { resolve(result.authSetting?.["scope.record"]); },
      fail() { resolve(undefined); }
    });
  });
}

function authorizeRecordPermission() {
  return new Promise((resolve) => {
    if (typeof uni.authorize !== "function") return resolve(false);
    uni.authorize({ scope: "scope.record", success: () => resolve(true), fail: () => resolve(false) });
  });
}

function openRecordPermissionSettings() {
  return new Promise((resolve) => {
    uni.showModal({
      title: "开启麦克风权限",
      content: "语音输入需要使用麦克风，请在微信设置中允许录音权限。",
      confirmText: "去设置",
      cancelText: "暂不开启",
      success(modalResult) {
        if (!modalResult.confirm || typeof uni.openSetting !== "function") return resolve(false);
        uni.openSetting({
          success(settingResult) { resolve(settingResult.authSetting?.["scope.record"] === true); },
          fail() { resolve(false); }
        });
      },
      fail() { resolve(false); }
    });
  });
}

export async function requestRecordPermission({ guideToSettings = false } = {}) {
  if (PLATFORM !== "mp-weixin") return true;
  const current = await readRecordPermission();
  if (current === true) return true;
  if (current === false) return guideToSettings ? openRecordPermissionSettings() : false;
  return authorizeRecordPermission();
}

export function createVoiceRecorder({ onStop, onError } = {}) {
  if (typeof uni.getRecorderManager !== "function") return null;
  const manager = uni.getRecorderManager();
  manager.onStop((result) => onStop?.(result));
  manager.onError((error) => onError?.(error));
  return {
    start() { manager.start({ duration: 60000, format: "mp3", sampleRate: 16000, numberOfChannels: 1 }); },
    stop() { manager.stop(); }
  };
}

export const runtimePlatform = PLATFORM;
