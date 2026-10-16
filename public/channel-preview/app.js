const root = document.querySelector("#previewRoot");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

async function load() {
  const deployment = new URLSearchParams(location.search).get("deployment");
  if (!deployment) throw new Error("缺少部署标识");
  const response = await fetch(`/api/admin/deployments/${encodeURIComponent(deployment)}/preview`);
  if (!response.ok) throw new Error("预览配置加载失败");
  const data = await response.json();
  document.documentElement.style.setProperty("--theme", data.channel.config.themeColor || data.workspace.accent || "#2a30d8");
  root.innerHTML = data.channelType === "miniapp" ? cardPreview(data) : websitePreview(data);
}

function identity(data) {
  const config = data.deployment.config;
  return {
    name: config.displayName || data.person.name,
    title: config.title || data.person.title,
    avatar: config.avatarUrl || data.person.avatarUrl,
    welcome: config.welcomeMessage || `您好，我是${data.person.name}。`
  };
}

function avatar(value, name, className = "avatar") {
  return value ? `<img class="${className}" src="${escapeHtml(value)}" alt=""/>` : `<span class="${className} avatar-text">${escapeHtml(name.slice(0, 1))}</span>`;
}

function cardPreview(data) {
  const current = identity(data);
  const config = data.deployment.config;
  const resources = Array.isArray(config.resources) ? config.resources : [];
  const questions = Array.isArray(config.suggestedQuestions) ? config.suggestedQuestions : [];
  return `<section class="phone card-channel">
    <header class="card-hero" ${config.coverUrl ? `style="background-image:linear-gradient(rgba(6,17,49,.18),rgba(6,17,49,.8)),url('${escapeHtml(config.coverUrl)}')"` : ""}>
      <span class="back">‹</span><div class="card-identity">${avatar(current.avatar, current.name, "hero-avatar")}<span><strong>${escapeHtml(current.name)}</strong><small>${escapeHtml(current.title || data.workspace.name)}</small></span></div><span class="miniapp-menu">•••　◉</span>
    </header>
    <div class="chat-feed">
      <div class="assistant-line">${avatar(data.channel.config.assistantAvatarUrl, data.channel.config.assistantName || "助手", "assistant-avatar")}<span>${escapeHtml(data.channel.config.assistantName || "智能助手")}</span></div>
      <article class="message-card"><strong>${escapeHtml(current.welcome)}</strong>${config.biography ? `<p>${escapeHtml(config.biography)}</p>` : `<p>我会结合当前公司的资料和服务能力，为您提供清晰、准确的解答。</p>`}</article>
      ${questions.length ? `<div class="question-list">${questions.map((item) => `<button>${escapeHtml(item)}</button>`).join("")}</div>` : ""}
      ${resources.length ? `<article class="resource-card"><h3>相关资料</h3>${resources.map((item) => `<div class="resource-row"><span class="pdf">PDF</span><strong>${escapeHtml(item.name)}</strong><button>预览</button></div>`).join("")}</article>` : ""}
      ${data.channel.config.leadFormEnabled ? `<article class="lead-card"><strong>留下您的联系方式</strong><label>怎么称呼您<input placeholder="请输入姓名"/></label><label>怎么联系到您<input placeholder="请输入联系方式"/></label><button>提交</button></article>` : ""}
    </div>
    <footer class="chat-composer"><button class="voice">◉</button><span>发送消息...</span><button class="add">＋</button><button class="send">➤</button></footer>
  </section>`;
}

function websitePreview(data) {
  const current = identity(data);
  const questions = Array.isArray(data.deployment.config.suggestedQuestions) ? data.deployment.config.suggestedQuestions : [];
  return `<section class="website-canvas">
    <div class="demo-site"><strong>${escapeHtml(data.workspace.name)}</strong><span>产品　服务　关于我们</span><div><h1>让智能服务随时在线</h1><p>这是官网页面中的客服悬浮层预览。</p></div></div>
    <aside class="widget-panel">
      <header><div>${avatar(current.avatar, current.name, "widget-avatar")}<span><strong>${escapeHtml(current.name)}</strong><small>${escapeHtml(current.title || "智能顾问")}</small></span></div><button>×</button></header>
      <div class="widget-chat"><span class="widget-message">${escapeHtml(current.welcome)}</span>${questions.map((item) => `<button class="quick-question">${escapeHtml(item)}</button>`).join("")}</div>
      <footer><input placeholder="请输入您的问题"/><button>➤</button></footer>
    </aside>
    <button class="widget-launcher">${avatar(current.avatar, current.name, "launcher-avatar")}<span>${escapeHtml(data.channel.config.launcherLabel || "在线咨询")}</span></button>
  </section>`;
}

load().catch((error) => { root.innerHTML = `<div class="preview-error">${escapeHtml(error.message)}</div>`; });

