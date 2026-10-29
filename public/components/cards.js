const ICONS = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/><polyline points="14 2 14 8 20 8"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
  rotate: '<path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  sparkles: '<path d="m12 3-1.6 4.1a2 2 0 0 1-1.1 1.1L5 10l4.3 1.7a2 2 0 0 1 1.1 1.1L12 17l1.6-4.2a2 2 0 0 1 1.1-1.1L19 10l-4.3-1.8a2 2 0 0 1-1.1-1.1Z"/><path d="M5 3v3M3.5 4.5h3M19 17v4M17 19h4"/>',
  thumbsDown: '<path d="M17 14V2M9 18.1 10 14H4.2a2 2 0 0 1-1.9-2.6l2.3-7A2 2 0 0 1 6.5 3H20a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.8 1.1L12 22h0a3.1 3.1 0 0 1-3-3.9Z"/>',
  thumbsUp: '<path d="M7 10v12M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2h0a3.1 3.1 0 0 1 3 3.9Z"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'
};

export const COMPONENT_TYPES = Object.freeze([
  "assistant-response",
  "assistant-loading",
  "suggestion-chips",
  "single-choice",
  "multi-choice",
  "action-button",
  "resource-list",
  "lead-form",
  "message",
  "voice-message",
  "attachment"
]);

export const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[character]);

export const componentIcon = (name) => `<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24">${ICONS[name] || ICONS.file}</svg>`;

function safeUrl(value, fallback = "#") {
  const url = String(value || "").trim();
  return /^(https?:\/\/|\/|#)/i.test(url) ? escapeHtml(url) : fallback;
}

function responseActions() {
  return `<div class="card-actions" data-response-actions><div>
    <button type="button" data-response-action="copy" title="复制" aria-label="复制回复">${componentIcon("copy")}</button>
    <button type="button" data-response-action="speak" title="朗读" aria-label="朗读回复" aria-pressed="false">${componentIcon("volume")}</button>
    <button type="button" data-response-action="like" title="有帮助" aria-label="有帮助" aria-pressed="false">${componentIcon("thumbsUp")}</button>
    <button type="button" data-response-action="dislike" title="没有帮助" aria-label="没有帮助" aria-pressed="false">${componentIcon("thumbsDown")}</button>
    <button type="button" data-response-action="share" title="分享" aria-label="分享回复">${componentIcon("share")}</button>
  </div><button type="button" data-response-action="regenerate" title="重新生成" aria-label="重新生成回复">${componentIcon("rotate")}</button></div>`;
}

let choiceSequence = 0;

function renderChoiceGroup(type, props) {
  const multiple = type === "multi-choice";
  const options = (Array.isArray(props.options) ? props.options : []).map((item) => typeof item === "string" ? { label: item, value: item, description: "" } : item);
  const selectedValues = new Set((Array.isArray(props.selectedValues) ? props.selectedValues : []).map((value) => String(value)));
  const submitted = props.submitted === true;
  const name = `dclaw-choice-${++choiceSequence}`;
  const choiceId = String(props.id || name);
  return `<form class="component-card dclaw-card dclaw-choice-card ${multiple ? "is-multiple" : "is-single"}${submitted ? " is-submitted" : ""}" data-component="${type}" data-choice-form data-choice-id="${escapeHtml(choiceId)}" data-choice-mode="${multiple ? "multiple" : "single"}">
    ${props.title ? `<div class="dclaw-choice-title"><strong>${escapeHtml(props.title)}</strong>${props.subtitle ? `<small>${escapeHtml(props.subtitle)}</small>` : ""}</div>` : ""}
    <div class="dclaw-choice-grid">${options.map((item) => {
      const value = String(item.value ?? item.label);
      return `<label class="dclaw-choice-option"><input type="${multiple ? "checkbox" : "radio"}" name="${name}" value="${escapeHtml(value)}" data-choice-label="${escapeHtml(item.label)}"${selectedValues.has(value) ? " checked" : ""}${submitted ? " disabled" : ""}/><span class="dclaw-choice-control"></span><span class="dclaw-choice-copy"><strong>${escapeHtml(item.label)}</strong>${item.description ? `<small>${escapeHtml(item.description)}</small>` : ""}</span></label>`;
    }).join("")}</div>
    <footer>${renderConversationComponent("action-button", { label: submitted ? "已提交" : props.submitLabel || "提交回答", action: "submit-choice", buttonType: "submit", disabled: submitted || !selectedValues.size })}</footer>
  </form>`;
}

export function renderConversationComponent(type, props = {}) {
  if (!COMPONENT_TYPES.includes(type)) throw new TypeError(`Unknown conversation component: ${type}`);
  if (type === "assistant-loading") {
    return `<div class="dclaw-agent-loading" data-component="assistant-loading" role="status" aria-live="polite" aria-atomic="true"><span>${escapeHtml(props.label || "正在思考")}</span><i aria-hidden="true"></i><i aria-hidden="true"></i><i aria-hidden="true"></i></div>`;
  }
  if (type === "assistant-response") {
    const content = props.content || [props.title, props.body].filter(Boolean).join("\n\n") || "请告诉我您的需求，我会为您整理清晰的建议。";
    return `<article class="component-card intro-card dclaw-card dclaw-answer-card" data-component="assistant-response">
      <div class="dclaw-answer-content">${escapeHtml(content)}</div>
      ${props.actions === false ? "" : responseActions()}
    </article>`;
  }
  if (type === "suggestion-chips") {
    const items = Array.isArray(props.items) ? props.items : [];
    return `<section class="dclaw-suggestion-group" data-component="suggestion-chips"><div class="dclaw-suggestion-title">${componentIcon("sparkles")}<span>${escapeHtml(props.label || "快捷提问")}</span></div><div class="question-list dclaw-suggestion-list">${items.map((item) => `<button data-question="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}</div></section>`;
  }
  if (type === "single-choice" || type === "multi-choice") return renderChoiceGroup(type, props);
  if (type === "action-button") {
    return `<button class="dclaw-action-button ${props.variant === "secondary" ? "is-secondary" : "is-primary"}" type="${props.buttonType === "submit" ? "submit" : "button"}" data-component="action-button" data-action="${escapeHtml(props.action || "action")}"${props.disabled ? " disabled" : ""}>${escapeHtml(props.label || "确认")}</button>`;
  }
  if (type === "resource-list") {
    const items = Array.isArray(props.items) ? props.items : [];
    return `<article class="component-card resource-card dclaw-card dclaw-resource-card" data-component="resource-list"><div class="component-title"><span>${escapeHtml(props.title || "资料中心")}</span><small>${items.length} 项</small></div>${items.map((item) => `<a class="resource-row" href="${safeUrl(item.url)}" target="_blank" rel="noopener"><span class="resource-type">${escapeHtml(item.type || "资料")}</span><strong>${escapeHtml(item.name || item.title)}</strong><span class="resource-open">↗</span></a>`).join("")}</article>`;
  }
  if (type === "lead-form") {
    return `<form class="component-card lead-card dclaw-card dclaw-lead-card" data-component="lead-form" data-lead-form><div class="component-title"><span>${escapeHtml(props.title || "保持联系")}</span><small>${escapeHtml(props.subtitle || "我们将尽快联系您")}</small></div><div class="dclaw-lead-fields"><label>怎么称呼您<input name="name" required placeholder="${escapeHtml(props.namePlaceholder || "请输入姓名")}"/></label><label>怎么联系到您<input name="contact" required placeholder="${escapeHtml(props.contactPlaceholder || "请输入手机号或微信号")}"/></label></div><footer>${renderConversationComponent("action-button", { label: props.submitLabel || "提交", action: "submit-lead", buttonType: "submit" })}</footer></form>`;
  }
  if (type === "message") {
    const customer = props.role !== "agent";
    return `<div class="${customer ? "customer-message" : "agent-message"} dclaw-message dclaw-message-${customer ? "customer" : "agent"}" data-component="message">${escapeHtml(props.content)}</div>`;
  }
  if (type === "voice-message") {
    const customer = props.role === "customer";
    const duration = Math.max(1, Math.round(Number(props.duration) || 1));
    return `<button type="button" class="${customer ? "customer-message" : "agent-message"} voice-message dclaw-message dclaw-voice-message" data-component="voice-message">${componentIcon("volume")}<span>${duration}''</span></button>`;
  }
  const attachment = props.attachment || props;
  const customer = props.role === "customer";
  const roleClass = customer ? "customer-message" : "agent-message";
  if (attachment.type === "single-choice" || attachment.type === "multi-choice") return renderConversationComponent(attachment.type, attachment);
  if (attachment.type === "action-button") return renderConversationComponent("action-button", attachment);
  if (attachment.type === "image") {
    return `<div class="${roleClass} attachment-message dclaw-message dclaw-image-message" data-component="attachment"><img src="${safeUrl(attachment.url)}" alt="${escapeHtml(attachment.name || "图片")}"/></div>`;
  }
  if (attachment.type === "card") {
    const picture = attachment.pictureUrl ? `<span class="dclaw-link-card-image"><img src="${safeUrl(attachment.pictureUrl)}" alt=""/></span>` : `<span class="dclaw-link-card-image is-fallback">${componentIcon("link")}</span>`;
    return `<a class="${roleClass} attachment-message dclaw-message dclaw-link-card" data-component="attachment" href="${safeUrl(attachment.url)}" target="_blank" rel="noopener">${picture}<span class="dclaw-link-card-copy"><strong>${escapeHtml(attachment.title || attachment.name || "查看卡片")}</strong>${attachment.subtitle ? `<small>${escapeHtml(attachment.subtitle)}</small>` : ""}<em>${escapeHtml(attachment.name || "打开详情")}</em></span></a>`;
  }
  return `<div class="${roleClass} attachment-message dclaw-message dclaw-file-message" data-component="attachment">${componentIcon("file")}<a href="${safeUrl(attachment.url)}" target="_blank" rel="noopener">${escapeHtml(attachment.name || attachment.title || "查看资料")}</a></div>`;
}

const SINGLE_CHOICE_DEMO = {
  id: "answer-mode",
  title: "选择回答方式",
  options: [
    { label: "引导问答", description: "通过交互逐步补充必要信息" },
    { label: "预填信息", description: "先使用已经整理的信息" },
    { label: "上传资料", description: "根据已有文件继续处理" }
  ]
};

const MULTI_CHOICE_DEMO = {
  id: "service-needs",
  title: "选择关注内容",
  subtitle: "可选择多项",
  options: [
    { label: "业务咨询", description: "了解服务范围" },
    { label: "方案设计", description: "整理落地方案" },
    { label: "案例资料", description: "查看相关案例" },
    { label: "预约沟通", description: "联系相关负责人" }
  ]
};

export const COMPONENT_DEMOS = Object.freeze([
  { type: "assistant-response", name: "回答卡片", props: { content: "您好，我是向小顶，很高兴认识您。\n\n我会结合集团业务资料，为您提供清晰、准确的解答。" } },
  { type: "suggestion-chips", name: "快捷问题", props: { items: ["你是谁", "怎么合作", "查看服务案例"] } },
  {
    type: "single-choice",
    name: "单选回答",
    states: [
      { label: "待选择", props: SINGLE_CHOICE_DEMO },
      { label: "已提交", props: { ...SINGLE_CHOICE_DEMO, submitted: true, selectedValues: ["引导问答"] }, customerMessage: "引导问答" }
    ]
  },
  {
    type: "multi-choice",
    name: "多选回答",
    states: [
      { label: "待选择", props: MULTI_CHOICE_DEMO },
      { label: "已提交", props: { ...MULTI_CHOICE_DEMO, submitted: true, selectedValues: ["业务咨询", "案例资料"] }, customerMessage: "业务咨询、案例资料" }
    ]
  },
  { type: "action-button", name: "操作按钮", props: { label: "提交回答", action: "demo-submit" } },
  { type: "resource-list", name: "资料列表", props: { items: [{ type: "PDF", name: "集团服务介绍", url: "#" }, { type: "案例", name: "AIGC 项目案例集", url: "#" }] } },
  { type: "lead-form", name: "留资表单", props: {} },
  { type: "message", name: "客户消息", props: { content: "我想咨询企业智能化方案。" } },
  { type: "voice-message", name: "语音消息", variants: [{ role: "agent", duration: 8 }, { role: "customer", duration: 12 }] },
  { type: "attachment", name: "附件卡片", variants: [{ attachment: { type: "card", title: "顶脉教育集团服务方案", subtitle: "企业智能化服务与落地案例", name: "查看完整方案", url: "#", pictureUrl: "/console/assets/moosee-work-serious-scene.png" } }, { attachment: { type: "file", name: "项目需求清单.pdf", url: "#" } }] }
]);
