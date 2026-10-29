import { renderConversationComponent } from "/components/cards.js";

const root = document.querySelector("#previewRoot");
const DEFAULT_MASCOT = "/console/assets/ddeer.png";
const DEFAULT_MASCOT_SCENE = "/console/assets/ddeer-transparent.png";
const DEFAULT_ASSISTANT_SCENE_VIDEO = "/console/assets/ddeer-office-greeting-rig-v3.mp4";
const DEFAULT_ASSISTANT_SCENE_POSTER = "/console/assets/ddeer-office-greeting-rig-poster-v3.jpg";
const DEFAULT_COVER = "/console/assets/moosee-work-serious-scene.png";
const DEFAULT_ASSISTANT_TOPICS = ["集团业务介绍", "课程与服务", "合作咨询", "联系我们"];
const DEFAULT_ASSISTANT_PRIMARY_ITEMS = ["了解集团服务", "查看课程体系", "领取合作资料"];
const DEFAULT_ASSISTANT_RECOMMENDED_ITEMS = ["热门方案推荐", "企业合作咨询", "预约专属服务"];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const safeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;
const safeLinkUrl = (value) => {
  const url = String(value || "").trim();
  if (!url) return "";
  try { return ["http:", "https:"].includes(new URL(url).protocol) ? url : ""; } catch { return ""; }
};
const icons = {
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/><circle cx="12" cy="13" r="3"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/><polyline points="14 2 14 8 20 8"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  keyboard: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M7 16h10"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 6L2 7"/>',
  mapPin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.7-5.1A8 8 0 1 1 21 15Z"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.33 1.84.56 2.8.69A2 2 0 0 1 22 16.92Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  rotate: '<path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/>',
  send: '<path d="m17 11-5-5-5 5"/><path d="M12 6v12"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  thumbsDown: '<path d="M17 14V2M9 18.1 10 14H4.2a2 2 0 0 1-1.9-2.6l2.3-7A2 2 0 0 1 6.5 3H20a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.8 1.1L12 22h0a3.1 3.1 0 0 1-3-3.9Z"/>',
  thumbsUp: '<path d="M7 10v12M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2h0a3.1 3.1 0 0 1 3 3.9Z"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'
};
const icon = (name) => `<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24">${icons[name]}</svg>`;
const randomId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

function persistentId(key) {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const value = randomId();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return randomId();
  }
}

function conversationOutboxUrl(endpoint, conversationId, after) {
  return endpoint.replace("{conversationId}", encodeURIComponent(conversationId)).replace(/after=\d+/, `after=${after}`);
}

async function primeOutboxCursor(endpoint, conversationId) {
  if (!endpoint || !conversationId) return 0;
  let after = 0;
  while (true) {
    const response = await fetch(conversationOutboxUrl(endpoint, conversationId, after));
    if (!response.ok) throw new Error("会话同步失败，请重试");
    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const next = items.reduce((cursor, item) => Math.max(cursor, Number(item.id || 0)), after);
    if (items.length < 100 || next <= after) return next;
    after = next;
  }
}

async function load() {
  const parameters = new URLSearchParams(location.search);
  const deploymentId = parameters.get("deployment");
  const channelId = parameters.get("channel");
  const pathMatch = location.pathname.match(/^\/channels\/([^/]+)\/?$/);
  const publicSlug = parameters.get("slug") || (pathMatch ? decodeURIComponent(pathMatch[1]) : "");
  if (!deploymentId && !channelId && !publicSlug) throw new Error("缺少渠道标识");
  const endpoint = deploymentId
    ? `/api/admin/deployments/${encodeURIComponent(deploymentId)}/preview`
    : channelId
      ? `/api/admin/channels/${encodeURIComponent(channelId)}/preview`
      : `/api/public/channels/${encodeURIComponent(publicSlug)}`;
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(deploymentId ? "预览配置加载失败" : "渠道尚未发布或已停用");
  const data = await response.json();
  data.deployments = Array.isArray(data.deployments) && data.deployments.length
    ? data.deployments
    : [{ ...data.deployment, person: data.person }];
  const cardSurface = parameters.get("surface") === "card";
  const viewData = data;
  root.innerHTML = data.channelType === "miniapp" || cardSurface ? cardPreview(viewData) : websitePreview(data);
  document.title = `${data.deployment.personName || data.person?.name || data.workspace.name} · ${data.channel.name}`;
  if (data.channelType === "miniapp" || cardSurface) bindCardPreview(viewData);
  else bindWebsitePreview(data);
}

function identity(data, deployment = data.deployment) {
  const person = deployment.person || data.person;
  const config = deployment.config || {};
  return {
    id: deployment.id,
    name: config.displayName || person?.name || "智能员工",
    title: config.title || person?.title || "智能员工",
    avatar: config.avatarUrl || person?.avatarUrl || "",
    welcome: config.welcomeMessage || `您好，我是${person?.name || "智能员工"}。`,
    config
  };
}

function avatar(value, name, className = "avatar") {
  return value
    ? `<img class="${className}" src="${escapeHtml(value)}" alt=""/>`
    : `<span class="${className} avatar-text">${escapeHtml(name.slice(0, 1))}</span>`;
}

function cardPreview(data) {
  const current = identity(data);
  const config = current.config;
  const channel = data.cardPresentation?.config || data.channel.config || {};
  const resources = Array.isArray(config.resources) ? config.resources : [];
  const questions = Array.isArray(config.suggestedQuestions) ? config.suggestedQuestions : [];
  const companyName = config.companyName || data.workspace.name;
  const biography = config.biography || `我是${current.name}，将结合${companyName}的业务资料，为您提供清晰、准确的解答。`;
  const profileAvatar = current.avatar || "/console/assets/bot-avatar.png";
  const assistantName = channel.assistantName || "D仔";
  const assistantBrandText = channel.assistantBrandText || "DClaw";
  const assistantAvatar = channel.assistantAvatarUrl || DEFAULT_MASCOT;
  const assistantSceneVideo = hasOwn(channel, "assistantSceneVideoUrl") ? channel.assistantSceneVideoUrl : DEFAULT_ASSISTANT_SCENE_VIDEO;
  const assistantScenePoster = hasOwn(channel, "assistantScenePosterUrl") ? channel.assistantScenePosterUrl : DEFAULT_ASSISTANT_SCENE_POSTER;
  const assistantSceneImage = channel.assistantMascotImageUrl || channel.assistantSceneImageUrl || DEFAULT_MASCOT_SCENE;
  const assistantGreeting = channel.assistantGreeting || `你好，我是${assistantName}，很高兴为你服务`;
  const assistantPrompt = channel.assistantPrompt || "你可以这样对我说：";
  const assistantTopics = Array.isArray(channel.assistantTopics) && channel.assistantTopics.length ? channel.assistantTopics : DEFAULT_ASSISTANT_TOPICS;
  const assistantPrimaryTitle = channel.assistantPrimaryTitle || `${assistantName}小助手`;
  const assistantPrimaryItems = Array.isArray(channel.assistantPrimaryItems) && channel.assistantPrimaryItems.length ? channel.assistantPrimaryItems : DEFAULT_ASSISTANT_PRIMARY_ITEMS;
  const assistantRecommendedTitle = channel.assistantRecommendedTitle || "专题推荐";
  const assistantRecommendedItems = Array.isArray(channel.assistantRecommendedItems) && channel.assistantRecommendedItems.length ? channel.assistantRecommendedItems : DEFAULT_ASSISTANT_RECOMMENDED_ITEMS;
  const assistantVoiceLabel = channel.assistantVoiceLabel || "按住 说话";
  const assistantVoiceHint = channel.assistantVoiceHint || "回答由 AI 生成，内容仅供参考";
  const voiceEnabled = channel.voiceEnabled !== false;
  const companyDescription = data.workspace.companyContext?.description || `${companyName}致力于为客户提供专业、可靠的产品与服务。`;
  const phoneContact = config.phone ? { label: "电话", value: config.phone, icon: "phone" } : null;
  const emailContact = config.email ? { label: "邮箱", value: config.email, icon: "mail" } : null;
  const addressContact = config.address ? { label: "地址", value: config.address, icon: "mapPin" } : null;
  const websiteContact = config.website ? { label: "官网", value: config.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), icon: "globe" } : null;
  const primaryContacts = (config.qrCodeUrl
    ? [websiteContact, emailContact]
    : [phoneContact, config.wechat ? { label: "微信", value: config.wechat, icon: "message" } : null, emailContact]
  ).filter(Boolean);
  const secondaryContacts = (config.qrCodeUrl
    ? [addressContact, phoneContact]
    : [addressContact, websiteContact]
  ).filter(Boolean);
  const contacts = [...primaryContacts, ...secondaryContacts];
  const completeContactLayout = primaryContacts.length === 2 && secondaryContacts.length === 2 && Boolean(config.qrCodeUrl);
  const renderContactRow = (items, className) => items.length ? `<div class="contact-row ${className} contact-count-${items.length}">${items.map((item) => `<span class="contact-item" title="${escapeHtml(item.label)}" aria-label="${escapeHtml(item.label)}：${escapeHtml(item.value)}">${icon(item.icon)}<strong>${escapeHtml(item.value)}</strong></span>`).join("")}</div>` : "";
  return `<section class="card-flip-stage" data-card-flip-stage style="--assistant-name-color:${safeColor(channel.assistantNameColor, "#29466f")};--assistant-brand-color:${safeColor(channel.assistantBrandColor, "#254e96")};--assistant-greeting-color:${safeColor(channel.assistantGreetingColor, "#315078")};--assistant-prompt-color:${safeColor(channel.assistantPromptColor, "#60718d")};--assistant-topics-color:${safeColor(channel.assistantTopicsColor, "#426086")};--assistant-primary-title-color:${safeColor(channel.assistantPrimaryTitleColor, "#ffffff")};--assistant-primary-items-color:${safeColor(channel.assistantPrimaryItemsColor, "#28344b")};--assistant-recommended-title-color:${safeColor(channel.assistantRecommendedTitleColor, "#ffffff")};--assistant-recommended-items-color:${safeColor(channel.assistantRecommendedItemsColor, "#28344b")};--assistant-voice-label-color:${safeColor(channel.assistantVoiceLabelColor, "#ffffff")};--assistant-voice-hint-color:${safeColor(channel.assistantVoiceHintColor, "#a2a7b1")}">
    <div class="card-flip-shell" data-card-flip-shell>
    <section class="phone card-channel card-face card-face-front is-expanded" data-card-shell data-card-front>
    <header class="card-hero" data-cover-url="${escapeHtml(config.coverUrl || DEFAULT_COVER)}">
      <div class="miniapp-chrome"><button class="chrome-back" title="返回">‹</button><span class="miniapp-menu">•••　◉</span></div>
      <div class="expanded-profile">
        <div class="card-identity">${avatar(profileAvatar, current.name, "hero-avatar")}<span class="identity-copy"><strong><span>${escapeHtml(current.name)}</span><i>在线</i></strong><small class="identity-meta"><span>${escapeHtml(current.title)}</span><b>·</b><span>${escapeHtml(companyName)}</span></small></span></div>
        ${(contacts.length || config.qrCodeUrl) ? `<div class="contact-panel${completeContactLayout ? " contact-layout-complete" : ""}" aria-label="联系方式">${renderContactRow(primaryContacts, "contact-primary")}${(secondaryContacts.length || config.qrCodeUrl) ? `<div class="contact-row contact-secondary contact-count-${secondaryContacts.length}${config.qrCodeUrl ? " has-qr" : ""}">${secondaryContacts.map((item) => `<span class="contact-item" title="${escapeHtml(item.label)}" aria-label="${escapeHtml(item.label)}：${escapeHtml(item.value)}">${icon(item.icon)}<strong>${escapeHtml(item.value)}</strong></span>`).join("")}${config.qrCodeUrl ? `<button type="button" class="contact-qr" data-qr-open title="点击放大二维码" aria-label="放大联系二维码"><img src="${escapeHtml(config.qrCodeUrl)}" alt=""/></button>` : ""}</div>` : ""}</div>` : ""}
      </div>
      <div class="compact-profile">${avatar(profileAvatar, current.name, "compact-avatar")}<span><strong><span>${escapeHtml(current.name)}</span><i>在线</i></strong><small>${escapeHtml(current.title)} · ${escapeHtml(companyName)}</small></span></div>
      <button class="hero-toggle" data-card-toggle title="收起名片" aria-expanded="true"><span></span></button>
    </header>
    ${config.qrCodeUrl ? `<div class="qr-lightbox" data-qr-lightbox role="dialog" aria-modal="true" aria-label="联系二维码" hidden><button type="button" class="qr-lightbox-backdrop" data-qr-close aria-label="关闭二维码"></button><section><button type="button" class="qr-lightbox-close" data-qr-close aria-label="关闭二维码">×</button><img src="${escapeHtml(config.qrCodeUrl)}" alt="联系二维码"/><strong>扫码联系</strong><small>长按或截图保存二维码</small></section></div>` : ""}
    <main class="chat-feed" data-chat-feed>
      ${renderConversationComponent("assistant-response", { content: `${current.welcome}\n\n${biography}` })}
      ${questions.length ? renderConversationComponent("suggestion-chips", { items: questions }) : ""}
      ${resources.length ? renderConversationComponent("resource-list", { items: resources }) : ""}
      <div class="message-stream" data-message-stream></div>
    </main>
    <footer class="composer-dock" data-composer-dock>
      <div class="recording-status" data-recording-status hidden><span></span><strong>松开发送，上滑取消</strong><time>00:00</time></div>
      <div class="chat-composer" data-chat-composer>
        <button class="composer-icon camera" data-image-picker title="拍照或选择图片">${icon("camera")}</button>
        <input data-image-input type="file" accept="image/*" capture="environment" hidden/>
        <input data-file-input type="file" hidden/>
        <input class="message-input" data-message-input placeholder="发消息..."/>
        <button class="voice-hold" data-voice-hold hidden>按住说话</button>
        ${voiceEnabled ? `<button class="composer-icon mode-toggle" data-input-mode title="切换语音输入">${icon("mic")}</button>` : ""}
        <button class="composer-icon send" data-message-send title="发送">${icon("send")}</button>
        <button class="composer-icon add" data-more-toggle title="更多功能">${icon("plus")}</button>
      </div>
      <div class="more-panel" data-more-panel hidden><button data-more-action="image">${icon("image")}<span>图片</span></button><button data-more-action="file">${icon("file")}<span>文件</span></button>${config.phone ? `<a href="tel:${escapeHtml(config.phone)}">${icon("phone")}<span>打电话</span></a>` : ""}</div>
      <div class="composer-toast" data-composer-toast hidden></div>
    </footer>
    </section>
    <section class="phone card-channel card-face card-face-back company-card-face" data-card-back aria-hidden="true">
      <main class="company-assistant-page${assistantSceneVideo ? " has-scene-video" : ""}" data-company-assistant-page>
        ${assistantSceneVideo ? `<video class="assistant-scene-video" data-assistant-scene-video autoplay muted loop playsinline preload="auto"${assistantScenePoster ? ` poster="${escapeHtml(assistantScenePoster)}"` : ""} aria-hidden="true"><source src="${escapeHtml(assistantSceneVideo)}" type="video/mp4"/></video>` : ""}
        <header class="assistant-conversation-header">
          <button type="button" data-assistant-home aria-label="返回全屏吉祥物语音助手">‹</button>
          <strong>${escapeHtml(assistantName)}</strong>
          ${voiceEnabled ? `<button type="button" class="assistant-header-sound" aria-label="朗读开关">${icon("volume")}</button>` : ""}
          <span class="miniapp-menu">•••　◉</span>
        </header>
        <section class="company-assistant-stage">
          <div class="miniapp-chrome"><button class="company-back-button" data-card-face="front" title="返回个人名片" aria-label="返回${escapeHtml(current.name)}的名片">‹</button><span class="miniapp-menu">•••　◉</span></div>
          <strong class="assistant-scene-brand">${escapeHtml(assistantBrandText)}</strong>
          <span class="assistant-music-note note-one">♪</span><span class="assistant-music-note note-two">♫</span><span class="assistant-star star-one">✦</span><span class="assistant-star star-two">✦</span>
          <i class="assistant-cloud cloud-one"></i><i class="assistant-cloud cloud-two"></i><i class="assistant-cloud cloud-three"></i>
          <div class="assistant-mascot-stage">
            <img class="assistant-scene-mascot" src="${escapeHtml(assistantSceneImage)}" alt="${escapeHtml(assistantName)}"/>
            <span class="assistant-speech" data-company-speech>${escapeHtml(assistantGreeting)}</span>
            <span class="assistant-company-name">${escapeHtml(companyName)}</span>
          </div>
          <div class="assistant-topic-cloud" aria-label="快捷话题">
            ${assistantTopics.map((item, index) => `<button type="button" class="assistant-topic topic-${(index % 4) + 1}" data-assistant-prompt="${escapeHtml(item)}">${escapeHtml(item)}<span>›</span></button>`).join("")}
          </div>
        </section>
        <section class="assistant-shortcuts">
          <p>${escapeHtml(assistantPrompt)}</p>
          <div class="assistant-shortcut-grid">
            <section class="assistant-shortcut-group primary-group">
              <strong>${escapeHtml(assistantPrimaryTitle)}</strong>
              ${assistantPrimaryItems.map((item, index) => `<button type="button" data-assistant-prompt="${escapeHtml(item)}"><i>${index === 0 ? "D" : index === 1 ? "礼" : "荐"}</i><span>${escapeHtml(item)}</span><b>›</b></button>`).join("")}
            </section>
            <section class="assistant-shortcut-group recommended-group">
              <strong>${escapeHtml(assistantRecommendedTitle)}</strong>
              ${assistantRecommendedItems.map((item, index) => `<button type="button" data-assistant-prompt="${escapeHtml(item)}"><i>${index === 0 ? "新" : index === 1 ? "企" : "约"}</i><span>${escapeHtml(item)}</span><b>›</b></button>`).join("")}
            </section>
          </div>
        </section>
        <section class="assistant-conversation message-stream" data-assistant-conversation aria-live="polite"></section>
        ${voiceEnabled ? `<footer class="assistant-voice-dock">
          <button type="button" class="assistant-voice-button" data-assistant-voice data-label="${escapeHtml(assistantVoiceLabel)}">${icon("mic")}<strong>${escapeHtml(assistantVoiceLabel)}</strong><span class="assistant-keyboard">${icon("keyboard")}</span></button>
          <small>${escapeHtml(assistantVoiceHint)}</small>
        </footer>` : ""}
      </main>
    </section>
    </div>
    <button type="button" class="card-face-trigger" data-card-face-toggle title="查看公司名片；可上下拖动调整位置" aria-label="查看${escapeHtml(companyName)}公司名片">
      <span class="face-label face-label-company">${escapeHtml(assistantName)}</span>
      <span class="face-label face-label-person">${escapeHtml(current.name)}</span>
      <span class="face-target face-target-company">${avatar(assistantAvatar, assistantName, "face-target-avatar")}</span>
      <span class="face-target face-target-person">${avatar(profileAvatar, current.name, "face-target-avatar")}</span>
      <i>${icon("rotate")}</i>
    </button>
  </section>`;
}

function bindCardPreview(data) {
  const flipStage = root.querySelector("[data-card-flip-stage]");
  const flipTrigger = root.querySelector("[data-card-face-toggle]");
  const frontFace = root.querySelector("[data-card-front]");
  const backFace = root.querySelector("[data-card-back]");
  const shell = root.querySelector("[data-card-shell]");
  const hero = root.querySelector(".card-hero");
  const toggle = root.querySelector("[data-card-toggle]");
  const input = root.querySelector("[data-message-input]");
  const stream = root.querySelector("[data-message-stream]");
  const feed = root.querySelector("[data-chat-feed]");
  const composer = root.querySelector("[data-chat-composer]");
  const composerDock = root.querySelector("[data-composer-dock]");
  const voiceHold = root.querySelector("[data-voice-hold]");
  const modeToggle = root.querySelector("[data-input-mode]");
  const morePanel = root.querySelector("[data-more-panel]");
  const imageInput = root.querySelector("[data-image-input]");
  const fileInput = root.querySelector("[data-file-input]");
  const recordingStatus = root.querySelector("[data-recording-status]");
  const toastNode = root.querySelector("[data-composer-toast]");
  const qrLightbox = root.querySelector("[data-qr-lightbox]");
  const companyAssistantPage = root.querySelector("[data-company-assistant-page]");
  const companyConversation = root.querySelector("[data-assistant-conversation]");
  const companySpeech = root.querySelector("[data-company-speech]");
  const companyVoice = root.querySelector("[data-assistant-voice]");
  const companySceneVideo = root.querySelector("[data-assistant-scene-video]");
  const current = identity(data);
  const channel = data.channel.config || {};
  const assistantName = channel.assistantName || "D仔";
  const assistantAvatar = channel.assistantAvatarUrl || DEFAULT_MASCOT;
  const assistantGreeting = channel.assistantGreeting || `你好，我是${assistantName}，很高兴为你服务`;
  companySceneVideo?.addEventListener("error", () => companyAssistantPage.classList.remove("has-scene-video"));
  companySceneVideo?.play().catch(() => {});
  const coverUrl = hero.dataset.coverUrl || DEFAULT_COVER;
  const liveChannel = !data.previewOnly && data.endpoints?.publicMessages;
  const liveCompanyAssistant = !data.previewOnly && data.endpoints?.assistantMessages;
  const sessionKey = `dclaw-channel:${data.deployment.publicSlug || data.deployment.id}`;
  const conversationId = liveChannel ? persistentId(`${sessionKey}:conversation`) : "";
  const userId = liveChannel ? persistentId(`${sessionKey}:visitor`) : "";
  const companyConversationId = liveCompanyAssistant ? persistentId(`${sessionKey}:assistant-conversation`) : "";
  const companyUserId = liveCompanyAssistant ? persistentId(`${sessionKey}:assistant-visitor`) : "";
  const faceTriggerPositionKey = `${sessionKey}:face-trigger-y`;
  let outboxAfter = 0;
  let companyOutboxAfter = 0;
  const outboxReady = liveChannel
    ? primeOutboxCursor(data.endpoints.publicOutbox, conversationId).then((cursor) => { outboxAfter = cursor; })
    : Promise.resolve();
  const companyOutboxReady = liveCompanyAssistant
    ? primeOutboxCursor(data.endpoints.assistantOutbox, companyConversationId).then((cursor) => { companyOutboxAfter = cursor; })
    : Promise.resolve();
  let recorder = null;
  let recordingStartedAt = 0;
  let recordingTimer = null;
  let recordingCanceled = false;
  let recordingSurface = "front";
  let pointerDown = false;
  let pointerStartY = 0;
  let faceTriggerDrag = null;
  let faceTriggerRatio = null;
  let suppressFaceFlip = false;
  root.querySelector(".chrome-back")?.addEventListener("click", () => {
    if (window.parent !== window) window.parent.postMessage({ type: "dclaw:website-card-back" }, location.origin);
    else if (history.length > 1) history.back();
  });
  hero.style.backgroundImage = `linear-gradient(180deg, rgba(4, 12, 31, .1), rgba(4, 12, 31, .88)), url("${coverUrl.replaceAll('"', "")}")`;

  function setCardFace(face) {
    const showBack = face === "back";
    flipStage.classList.toggle("is-flipped", showBack);
    frontFace.inert = showBack;
    backFace.inert = !showBack;
    frontFace.setAttribute("aria-hidden", String(showBack));
    backFace.setAttribute("aria-hidden", String(!showBack));
    const actionLabel = showBack ? `返回${current.name}的名片` : `查看${data.workspace.name}公司名片`;
    flipTrigger.title = `${actionLabel}；可上下拖动调整位置`;
    flipTrigger.setAttribute("aria-label", actionLabel);
    if (showBack) {
      input.blur();
      morePanel.hidden = true;
      companySceneVideo?.play().catch(() => {});
    } else {
      companySceneVideo?.pause();
    }
  }

  function setExpanded(expanded) {
    shell.classList.toggle("is-expanded", expanded);
    shell.classList.toggle("is-compact", !expanded);
    toggle.title = expanded ? "收起名片" : "展开名片";
    toggle.setAttribute("aria-expanded", String(expanded));
  }

  function scrollToBottom() {
    requestAnimationFrame(() => { feed.scrollTop = feed.scrollHeight; });
  }

  function faceTriggerBounds() {
    const minimum = 72;
    const bottomClearance = Math.max(86, composerDock.offsetHeight + 12);
    return {
      minimum,
      maximum: Math.max(minimum, flipStage.clientHeight - flipTrigger.offsetHeight - bottomClearance)
    };
  }

  function positionFaceTrigger(ratio = faceTriggerRatio) {
    const { minimum, maximum } = faceTriggerBounds();
    if (!Number.isFinite(ratio)) ratio = (Math.min(maximum, 154) - minimum) / Math.max(1, maximum - minimum);
    faceTriggerRatio = Math.min(1, Math.max(0, ratio));
    flipTrigger.style.top = `${minimum + ((maximum - minimum) * faceTriggerRatio)}px`;
  }

  function saveFaceTriggerPosition() {
    try {
      localStorage.setItem(faceTriggerPositionKey, String(faceTriggerRatio));
    } catch {
      // The drag still works when browser storage is unavailable.
    }
  }

  function beginFaceTriggerDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const triggerRect = flipTrigger.getBoundingClientRect();
    faceTriggerDrag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      offsetY: event.clientY - triggerRect.top,
      moved: false
    };
    flipTrigger.setPointerCapture?.(event.pointerId);
    flipTrigger.classList.add("is-dragging");
  }

  function moveFaceTrigger(event) {
    if (!faceTriggerDrag || event.pointerId !== faceTriggerDrag.pointerId) return;
    if (!faceTriggerDrag.moved && Math.abs(event.clientY - faceTriggerDrag.startY) < 5) return;
    faceTriggerDrag.moved = true;
    suppressFaceFlip = true;
    const stageRect = flipStage.getBoundingClientRect();
    const { minimum, maximum } = faceTriggerBounds();
    const top = Math.min(maximum, Math.max(minimum, event.clientY - stageRect.top - faceTriggerDrag.offsetY));
    faceTriggerRatio = (top - minimum) / Math.max(1, maximum - minimum);
    flipTrigger.style.top = `${top}px`;
    event.preventDefault();
  }

  function finishFaceTriggerDrag(event) {
    if (!faceTriggerDrag || event.pointerId !== faceTriggerDrag.pointerId) return;
    const moved = faceTriggerDrag.moved;
    faceTriggerDrag = null;
    flipTrigger.classList.remove("is-dragging");
    if (moved) saveFaceTriggerPosition();
    setTimeout(() => { suppressFaceFlip = false; }, 0);
  }

  function appendAgentReply(content, attachments = []) {
    if (content) stream.insertAdjacentHTML("beforeend", renderConversationComponent("assistant-response", { content }));
    for (const attachment of attachments) {
      stream.insertAdjacentHTML("beforeend", renderConversationComponent("attachment", { role: "agent", attachment }));
    }
    scrollToBottom();
  }

  async function withAgentLoading(target, scroll, task) {
    target.insertAdjacentHTML("beforeend", renderConversationComponent("assistant-loading"));
    const loadingNode = target.lastElementChild;
    scroll();
    try {
      return await task();
    } finally {
      loadingNode?.remove();
      scroll();
    }
  }

  function scrollCompanyToLatest() {
    requestAnimationFrame(() => companyConversation.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function pollOutbox() {
    if (!liveChannel) return;
    const url = conversationOutboxUrl(data.endpoints.publicOutbox, conversationId, outboxAfter);
    const response = await fetch(url);
    if (!response.ok) throw new Error("回复加载失败");
    const payload = await response.json();
    for (const item of payload.items || []) {
      outboxAfter = Math.max(outboxAfter, Number(item.id || 0));
      appendAgentReply(item.content, item.attachments);
    }
  }

  async function deliverMessage({ text, type = "text", attachments = [] }) {
    if (!liveChannel) {
      appendAgentReply(current.welcome);
      return;
    }
    await outboxReady;
    const response = await fetch(data.endpoints.publicMessages, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId,
        userId,
        displayName: "名片访客",
        message: { id: randomId(), type, text, attachments }
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "消息发送失败");
    const failed = payload.items?.find((item) => item.handledBy === "error");
    if (failed) throw new Error(failed.error || "Agent 暂时无法回复");
    await pollOutbox();
  }

  async function uploadMedia(blob, name) {
    if (!liveChannel) return null;
    const response = await fetch(data.endpoints.publicMedia, {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream", "X-File-Name": encodeURIComponent(name) },
      body: blob
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "媒体上传失败");
    return payload.attachment;
  }

  async function sendMessage() {
    const value = input.value.trim();
    if (!value) return;
    setExpanded(false);
    stream.insertAdjacentHTML("beforeend", renderConversationComponent("message", { role: "customer", content: value }));
    input.value = "";
    syncSendState();
    scrollToBottom();
    try {
      await withAgentLoading(stream, scrollToBottom, () => deliverMessage({ text: value }));
    } catch (error) {
      showToast(error.message || "消息发送失败");
    }
  }

  function showToast(message) {
    toastNode.textContent = message;
    toastNode.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toastNode.hidden = true; }, 2200);
  }

  function setInputMode(mode) {
    const voiceMode = mode === "voice";
    if (voiceMode && !modeToggle) return;
    composer.classList.toggle("voice-mode", voiceMode);
    input.hidden = voiceMode;
    voiceHold.hidden = !voiceMode;
    if (modeToggle) {
      modeToggle.title = voiceMode ? "切换文字输入" : "切换语音输入";
      modeToggle.innerHTML = icon(voiceMode ? "keyboard" : "mic");
    }
    if (!voiceMode) input.focus();
  }

  function syncSendState() {
    const hasText = Boolean(input.value.trim());
    composer.classList.toggle("has-text", hasText);
    if (hasText) morePanel.hidden = true;
  }

  async function submitChoice(form) {
    const selected = [...form.querySelectorAll("input:checked")].map((item) => item.dataset.choiceLabel || item.value);
    if (!selected.length) return showToast("请先选择答案");
    const controls = [...form.querySelectorAll("input")];
    const button = form.querySelector("[data-action='submit-choice']");
    controls.forEach((control) => { control.disabled = true; });
    button.disabled = true;
    button.textContent = "提交中...";
    const answer = selected.join("、");
    setExpanded(false);
    stream.insertAdjacentHTML("beforeend", renderConversationComponent("message", { role: "customer", content: answer }));
    scrollToBottom();
    try {
      await withAgentLoading(stream, scrollToBottom, () => deliverMessage({ text: answer }));
      button.textContent = "已提交";
      form.classList.add("is-submitted");
    } catch (error) {
      controls.forEach((control) => { control.disabled = false; });
      button.disabled = false;
      button.textContent = "重新提交";
      showToast(error.message || "回答提交失败");
    }
  }

  async function appendAttachment(file, kind) {
    if (!file) return;
    setExpanded(false);
    const previewUrl = kind === "image" ? URL.createObjectURL(file) : "#";
    stream.insertAdjacentHTML("beforeend", renderConversationComponent("attachment", { role: "customer", attachment: { type: kind, url: previewUrl, name: file.name } }));
    scrollToBottom();
    try {
      await withAgentLoading(stream, scrollToBottom, async () => {
        const attachment = await uploadMedia(file, file.name);
        await deliverMessage({ text: kind === "image" ? "[图片]" : `[文件] ${file.name}`, type: kind, attachments: attachment ? [attachment] : [] });
      });
    } catch (error) {
      showToast(error.message || "附件发送失败");
    }
  }

  async function appendVoiceMessage(blob, duration) {
    setExpanded(false);
    const url = URL.createObjectURL(blob);
    stream.insertAdjacentHTML("beforeend", renderConversationComponent("voice-message", { role: "customer", duration }));
    const message = stream.lastElementChild;
    const audio = new Audio(url);
    message.addEventListener("click", () => { audio.currentTime = 0; audio.play().catch(() => showToast("语音播放失败")); });
    stream.append(message);
    scrollToBottom();
    try {
      await withAgentLoading(stream, scrollToBottom, async () => {
        const attachment = await uploadMedia(blob, `voice-${Date.now()}.webm`);
        await deliverMessage({ text: `[语音消息 ${Math.max(1, Math.round(duration))} 秒]`, type: "audio", attachments: attachment ? [attachment] : [] });
      });
    } catch (error) {
      showToast(error.message || "语音发送失败");
    }
  }

  async function appendCompanyVoiceMessage(blob, duration) {
    companyAssistantPage.classList.add("is-conversation");
    const url = URL.createObjectURL(blob);
    companyConversation.insertAdjacentHTML("beforeend", renderConversationComponent("voice-message", { role: "customer", duration }));
    const message = companyConversation.lastElementChild;
    const audio = new Audio(url);
    message.addEventListener("click", () => { audio.currentTime = 0; audio.play().catch(() => showToast("语音播放失败")); });
    try {
      await withAgentLoading(companyConversation, scrollCompanyToLatest, async () => {
        const attachment = await uploadMedia(blob, `voice-${Date.now()}.webm`);
        const prompt = `[语音消息 ${Math.max(1, Math.round(duration))} 秒]`;
        if (!liveCompanyAssistant) {
          companyConversation.insertAdjacentHTML("beforeend", renderConversationComponent("assistant-response", { content: `${assistantName}已收到你的语音。` }));
        } else {
          await companyOutboxReady;
          const response = await fetch(data.endpoints.assistantMessages, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId: companyConversationId, userId: companyUserId, displayName: "公司名片访客", message: { id: randomId(), type: "audio", text: prompt, attachments: attachment ? [attachment] : [] } })
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || "语音发送失败");
          await pollCompanyOutbox();
        }
      });
    } catch (error) {
      showToast(error.message || "语音发送失败");
    }
    scrollCompanyToLatest();
  }

  function updateRecordingTime() {
    const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
    recordingStatus.querySelector("time").textContent = `00:${String(seconds).padStart(2, "0")}`;
  }

  async function beginRecording(event, surface = "front") {
    if (!window.isSecureContext) return showToast("浏览器录音需要 HTTPS；微信小程序可直接使用");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return showToast("当前浏览器不支持语音录制");
    pointerDown = true;
    recordingCanceled = false;
    recordingSurface = surface;
    pointerStartY = event.clientY;
    const trigger = surface === "company" ? companyVoice : voiceHold;
    trigger?.setPointerCapture?.(event.pointerId);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!pointerDown) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      const chunks = [];
      recorder = new MediaRecorder(mediaStream);
      recorder.addEventListener("dataavailable", (item) => { if (item.data.size) chunks.push(item.data); });
      recorder.addEventListener("stop", () => {
        const duration = (Date.now() - recordingStartedAt) / 1000;
        mediaStream.getTracks().forEach((track) => track.stop());
        if (!recordingCanceled && chunks.length && duration >= .35) {
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          if (recordingSurface === "company") appendCompanyVoiceMessage(blob, duration);
          else appendVoiceMessage(blob, duration);
        }
        else if (!recordingCanceled) showToast("录音时间太短");
      });
      recorder.start();
      recordingStartedAt = Date.now();
      if (surface === "company") {
        companyVoice.classList.add("is-listening");
        companyVoice.querySelector("strong").textContent = "松开发送，上滑取消";
        companySpeech.textContent = "我在听，请说吧...";
      } else {
        recordingStatus.classList.remove("will-cancel");
        recordingStatus.querySelector("strong").textContent = "松开发送，上滑取消";
        recordingStatus.hidden = false;
        composerDock.classList.add("is-recording");
      }
      recordingTimer = setInterval(updateRecordingTime, 250);
      updateRecordingTime();
    } catch {
      pointerDown = false;
      showToast("需要允许麦克风权限才能录音");
    }
  }

  function finishRecording(cancel = false) {
    pointerDown = false;
    recordingCanceled = cancel || recordingCanceled;
    clearInterval(recordingTimer);
    recordingStatus.hidden = true;
    composerDock.classList.remove("is-recording");
    companyVoice?.classList.remove("is-listening");
    if (companyVoice) companyVoice.querySelector("strong").textContent = companyVoice.dataset.label;
    if (recordingSurface === "company") companySpeech.textContent = recordingCanceled ? assistantGreeting : "收到，我正在为你整理答案。";
    if (recorder?.state === "recording") recorder.stop();
  }

  function moveRecording(event, surface = "front") {
    if (!pointerDown || recordingSurface !== surface) return;
    recordingCanceled = pointerStartY - event.clientY > 70;
    if (surface === "company") {
      companyVoice.querySelector("strong").textContent = recordingCanceled ? "松开取消" : "松开发送，上滑取消";
    } else {
      recordingStatus.classList.toggle("will-cancel", recordingCanceled);
      recordingStatus.querySelector("strong").textContent = recordingCanceled ? "松开取消" : "松开发送，上滑取消";
    }
  }

  try {
    faceTriggerRatio = Number.parseFloat(localStorage.getItem(faceTriggerPositionKey));
  } catch {
    faceTriggerRatio = null;
  }
  positionFaceTrigger();
  window.addEventListener("resize", () => positionFaceTrigger());
  flipTrigger.addEventListener("pointerdown", beginFaceTriggerDrag);
  flipTrigger.addEventListener("pointermove", moveFaceTrigger);
  flipTrigger.addEventListener("pointerup", finishFaceTriggerDrag);
  flipTrigger.addEventListener("pointercancel", finishFaceTriggerDrag);
  toggle.addEventListener("click", () => setExpanded(!shell.classList.contains("is-expanded")));
  flipTrigger.addEventListener("click", (event) => {
    if (suppressFaceFlip) {
      event.preventDefault();
      return;
    }
    setCardFace(flipStage.classList.contains("is-flipped") ? "front" : "back");
  });
  root.querySelectorAll("[data-card-face]").forEach((button) => button.addEventListener("click", () => setCardFace(button.dataset.cardFace)));
  async function pollCompanyOutbox() {
    if (!liveCompanyAssistant) return;
    const url = conversationOutboxUrl(data.endpoints.assistantOutbox, companyConversationId, companyOutboxAfter);
    const response = await fetch(url);
    if (!response.ok) throw new Error("回复加载失败");
    const payload = await response.json();
    for (const item of payload.items || []) {
      companyOutboxAfter = Math.max(companyOutboxAfter, Number(item.id || 0));
      if (item.content) companyConversation.insertAdjacentHTML("beforeend", renderConversationComponent("assistant-response", { content: item.content }));
      for (const attachment of item.attachments || []) companyConversation.insertAdjacentHTML("beforeend", renderConversationComponent("attachment", { role: "agent", attachment }));
    }
  }

  async function appendCompanyConversation(prompt, { appendCustomer = true } = {}) {
    companyAssistantPage.classList.add("is-conversation");
    if (appendCustomer) companyConversation.insertAdjacentHTML("beforeend", renderConversationComponent("message", { role: "customer", content: prompt }));
    try {
      await withAgentLoading(companyConversation, scrollCompanyToLatest, async () => {
        if (!liveCompanyAssistant) {
          companyConversation.insertAdjacentHTML("beforeend", renderConversationComponent("assistant-response", { content: `关于“${prompt}”，我是${assistantName}，可以结合${data.workspace.name}的业务资料为你继续介绍。你也可以直接说出更具体的需求。` }));
        } else {
          await companyOutboxReady;
          const response = await fetch(data.endpoints.assistantMessages, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId: companyConversationId, userId: companyUserId, displayName: "公司名片访客", message: { id: randomId(), type: "text", text: prompt, attachments: [] } })
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || "消息发送失败");
          await pollCompanyOutbox();
        }
      });
    } catch (error) {
      companyConversation.insertAdjacentHTML("beforeend", renderConversationComponent("assistant-response", { content: error.message || "公司助手暂时无法回复" }));
    }
    scrollCompanyToLatest();
  }
  root.querySelectorAll("[data-assistant-prompt]").forEach((button) => button.addEventListener("click", () => {
    root.querySelectorAll("[data-assistant-prompt]").forEach((item) => item.classList.toggle("is-active", item === button));
    companySpeech.textContent = `想了解“${button.dataset.assistantPrompt}”？我来为你介绍。`;
    companySpeech.classList.remove("is-updating");
    requestAnimationFrame(() => companySpeech.classList.add("is-updating"));
    appendCompanyConversation(button.dataset.assistantPrompt);
  }));
  root.querySelector("[data-assistant-home]")?.addEventListener("click", () => {
    companyAssistantPage.classList.remove("is-conversation");
    companySpeech.textContent = assistantGreeting;
    root.querySelectorAll("[data-assistant-prompt]").forEach((item) => item.classList.remove("is-active"));
    companyAssistantPage.scrollTo({ top: 0, behavior: "smooth" });
  });
  companyVoice?.addEventListener("pointerdown", (event) => beginRecording(event, "company"));
  companyVoice?.addEventListener("pointermove", (event) => moveRecording(event, "company"));
  companyVoice?.addEventListener("pointerup", () => finishRecording(recordingCanceled));
  companyVoice?.addEventListener("pointercancel", () => finishRecording(true));
  setCardFace("front");
  root.querySelector("[data-qr-open]")?.addEventListener("click", () => {
    qrLightbox.hidden = false;
    qrLightbox.querySelector("[data-qr-close]").focus();
  });
  qrLightbox?.querySelectorAll("[data-qr-close]").forEach((button) => button.addEventListener("click", () => { qrLightbox.hidden = true; }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && qrLightbox && !qrLightbox.hidden) qrLightbox.hidden = true;
  });
  root.querySelector("[data-message-send]").addEventListener("click", sendMessage);
  input.addEventListener("input", syncSendState);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") sendMessage(); });
  root.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => { input.value = button.dataset.question; sendMessage(); }));
  modeToggle?.addEventListener("click", () => setInputMode(composer.classList.contains("voice-mode") ? "text" : "voice"));
  root.querySelector("[data-image-picker]").addEventListener("click", () => imageInput.click());
  imageInput.addEventListener("change", () => appendAttachment(imageInput.files[0], "image"));
  fileInput.addEventListener("change", () => appendAttachment(fileInput.files[0], "file"));
  root.querySelector("[data-more-toggle]").addEventListener("click", () => { morePanel.hidden = !morePanel.hidden; });
  root.querySelector("[data-more-action='image']").addEventListener("click", () => imageInput.click());
  root.querySelector("[data-more-action='file']").addEventListener("click", () => fileInput.click());
  root.addEventListener("change", (event) => {
    const form = event.target.closest("[data-choice-form]");
    if (!form || form.classList.contains("is-submitted")) return;
    form.querySelector("[data-action='submit-choice']").disabled = !form.querySelector("input:checked");
  });
  root.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-choice-form]");
    if (!form) return;
    event.preventDefault();
    submitChoice(form);
  });
  voiceHold?.addEventListener("pointerdown", (event) => beginRecording(event, "front"));
  voiceHold?.addEventListener("pointermove", (event) => moveRecording(event, "front"));
  voiceHold?.addEventListener("pointerup", () => finishRecording(recordingCanceled));
  voiceHold?.addEventListener("pointercancel", () => finishRecording(true));
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-response-action]");
    if (!button) return;
    const action = button.dataset.responseAction;
    const responseCard = button.closest("[data-component='assistant-response']");
    const responseText = responseCard?.querySelector(".dclaw-answer-content")?.innerText || current.welcome;
    const responseStream = responseCard?.closest("[data-assistant-conversation]") || stream;
    const isCompanyResponse = responseStream === companyConversation;
    if (action === "copy") {
      await navigator.clipboard?.writeText(responseText).catch(() => {});
      showToast("已复制回复");
    } else if (action === "speak") {
      if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return showToast("当前浏览器不支持朗读");
      if (button.classList.contains("active")) {
        window.speechSynthesis.cancel();
        button.classList.remove("active");
        button.setAttribute("aria-pressed", "false");
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(responseText);
      utterance.lang = "zh-CN";
      utterance.onend = utterance.onerror = () => {
        button.classList.remove("active");
        button.setAttribute("aria-pressed", "false");
      };
      button.classList.add("active");
      button.setAttribute("aria-pressed", "true");
      window.speechSynthesis.speak(utterance);
    } else if (action === "share") {
      if (navigator.share) await navigator.share({ title: isCompanyResponse ? assistantName : current.name, text: responseText, url: location.href }).catch(() => {});
      else showToast("分享链接已准备");
    } else if (action === "regenerate") {
      responseStream.insertAdjacentHTML("beforeend", renderConversationComponent("assistant-response", { content: responseText }));
      requestAnimationFrame(() => {
        if (isCompanyResponse) responseStream.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "start" });
        else feed.scrollTop = feed.scrollHeight;
      });
    } else if (action === "like" || action === "dislike") {
      const pressed = !button.classList.contains("active");
      responseCard.querySelectorAll("[data-response-action='like'], [data-response-action='dislike']").forEach((item) => {
        item.classList.remove("active");
        item.setAttribute("aria-pressed", "false");
      });
      button.classList.toggle("active", pressed);
      button.setAttribute("aria-pressed", String(pressed));
    } else {
      button.classList.toggle("active");
    }
  });

  const syncViewport = () => document.documentElement.style.setProperty("--app-height", `${window.visualViewport?.height || window.innerHeight}px`);
  window.visualViewport?.addEventListener("resize", syncViewport);
  syncViewport();
}

function websitePreview(data) {
  const channel = data.channel.config || {};
  const mascot = channel.mascotImageUrl || DEFAULT_MASCOT;
  const agents = data.deployments.map((deployment) => identity(data, deployment));
  const launcherX = Math.max(0.04, Math.min(0.96, Number(channel.launcherPositionX ?? (channel.position === "left" ? 0.08 : 0.92)) || 0.92));
  const launcherY = Math.max(0.08, Math.min(0.94, Number(channel.launcherPositionY ?? 0.88) || 0.88));
  const companyName = channel.companyName || data.workspace.name;
  const companyDescription = channel.companyDescription || "多位团队成员，随时为访客提供一对一服务。";
  const homepageImage = channel.homepageImageUrl || "/console/assets/moosee-work-serious-scene.png";
  const heroButtonLabel = channel.heroButtonLabel || "了解更多";
  const heroButtonUrl = safeLinkUrl(channel.heroButtonUrl);
  const heroAction = heroButtonUrl
    ? `<a href="${escapeHtml(heroButtonUrl)}" target="_blank" rel="noopener">${escapeHtml(heroButtonLabel)}</a>`
    : `<button type="button" disabled title="尚未配置跳转地址">${escapeHtml(heroButtonLabel)}</button>`;
  return `<section class="website-canvas ${launcherX < 0.5 ? "dock-left" : "dock-right"}" style="--launcher-x:${launcherX * 100}%;--launcher-y:${launcherY * 100}%;--homepage-image:url(&quot;${escapeHtml(homepageImage)}&quot;);--company-name-color:${safeColor(channel.companyNameColor, "#ffffff")};--company-description-color:${safeColor(channel.companyDescriptionColor, "#ffffff")};--hero-button-label-color:${safeColor(channel.heroButtonLabelColor, "#ffffff")};--launcher-label-color:${safeColor(channel.launcherLabelColor, "#ffffff")};--roster-title-color:${safeColor(channel.rosterTitleColor, "#ffffff")}">
    <div class="demo-site">
      <div class="demo-nav"><strong>${escapeHtml(companyName)}</strong><span>产品　服务　案例　关于我们</span></div>
      <div class="demo-hero"><span>智能服务中心</span><h1>${escapeHtml(companyName)}<br/>在线服务中心</h1><p>${escapeHtml(companyDescription)}</p>${heroAction}</div>
    </div>
    <aside class="widget-panel" data-widget-panel>
      <header class="roster-header" data-widget-header><div><img class="mascot-avatar" src="${escapeHtml(mascot)}" alt=""/><span><strong>${escapeHtml(channel.rosterTitle || "选择成员")}</strong><small>${agents.length} 位成员在线</small></span></div><button data-widget-close title="关闭">×</button></header>
      <div class="agent-roster" data-agent-roster>
        ${agents.length ? agents.map((agent) => `<button class="agent-option" data-agent-select="${escapeHtml(agent.id)}">${avatar(agent.avatar, agent.name, "roster-avatar")}<span><strong>${escapeHtml(agent.name)}</strong><small>${escapeHtml(agent.title)}</small></span><i>联系</i></button>`).join("") : `<div class="empty-roster">暂未配置可用成员</div>`}
      </div>
      <div class="widget-card-view" data-widget-card hidden><iframe data-widget-card-frame title="智能员工名片"></iframe></div>
    </aside>
    <button class="widget-launcher" data-widget-launcher><img class="launcher-mascot" src="${escapeHtml(mascot)}" alt=""/><span>${escapeHtml(channel.launcherLabel || "在线咨询")}</span></button>
  </section>`;
}

function bindWebsitePreview(data) {
  const panel = root.querySelector("[data-widget-panel]");
  const header = root.querySelector("[data-widget-header]");
  const roster = root.querySelector("[data-agent-roster]");
  const card = root.querySelector("[data-widget-card]");
  const frame = root.querySelector("[data-widget-card-frame]");
  const launcher = root.querySelector("[data-widget-launcher]");
  const channel = data.channel.config || {};
  const mascot = channel.mascotImageUrl || DEFAULT_MASCOT;
  let currentDeploymentId = "";

  function showRoster() {
    currentDeploymentId = "";
    panel.classList.remove("card-open");
    launcher.hidden = false;
    header.hidden = false;
    roster.hidden = false;
    card.hidden = true;
    frame.removeAttribute("src");
    header.innerHTML = `<div><img class="mascot-avatar" src="${escapeHtml(mascot)}" alt=""/><span><strong>${escapeHtml(channel.rosterTitle || "选择成员")}</strong><small>${data.deployments.length} 位成员在线</small></span></div><button data-widget-close title="关闭">×</button>`;
    header.querySelector("[data-widget-close]").addEventListener("click", () => { panel.hidden = true; });
  }

  function showCard(deploymentId) {
    const deployment = data.deployments.find((item) => item.id === deploymentId);
    if (!deployment) return;
    currentDeploymentId = deployment.id;
    const parameters = new URLSearchParams({ surface: "card" });
    if (data.previewOnly) {
      parameters.set("channel", data.channel.id);
      parameters.set("preview", "draft");
    } else if (data.mode !== "published") {
      parameters.set("deployment", deployment.id);
      parameters.set("preview", "draft");
    }
    frame.src = `/channels/${encodeURIComponent(deployment.publicSlug || "channel-preview")}?${parameters}`;
    panel.classList.add("card-open");
    launcher.hidden = true;
    header.hidden = true;
    roster.hidden = true;
    card.hidden = false;
  }

  launcher.addEventListener("click", () => { panel.hidden = !panel.hidden; if (!panel.hidden && !currentDeploymentId) showRoster(); });
  root.querySelectorAll("[data-agent-select]").forEach((button) => button.addEventListener("click", () => showCard(button.dataset.agentSelect)));
  root.querySelector("[data-widget-close]").addEventListener("click", () => { panel.hidden = true; });
  window.addEventListener("message", (event) => {
    if (event.origin === location.origin && event.source === frame.contentWindow && event.data?.type === "dclaw:website-card-back") showRoster();
  });
}

load().catch((error) => { root.innerHTML = `<div class="preview-error">${escapeHtml(error.message)}</div>`; });
