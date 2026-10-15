import { createFlowEditor } from "./flow-editor.js";
import { createTagEditor } from "./tag-editor.js";

const state = {
  accounts: [],
  account: null,
  activeTab: ["cockpit", "sessions", "flow", "tags", "push", "logs", "config"].includes(new URLSearchParams(location.search).get("tab")) ? new URLSearchParams(location.search).get("tab") : "cockpit",
  conversations: [],
  conversation: null,
  machine: { enabled: false, config: { entryNodeId: "", nodes: [] } },
  tags: [],
  alerts: []
};

const els = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.getAttribute("id"), element]));
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
let alertsLoaded = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function showToast(message, error = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle("error", error);
  els.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { els.toast.hidden = true; }, 2800);
}

const flowEditor = createFlowEditor({
  api, toast: showToast, icon, escapeHtml,
  getAccountId: () => state.account?.id || "",
  onChanged: (machine) => { state.machine = machine; renderStateOptions(); }
});
const tagEditor = createTagEditor({
  api, toast: showToast, icon, escapeHtml,
  getAccountId: () => state.account?.id || "",
  onChanged: (schema) => { state.tags = schema.groups.flatMap((group) => group.tags.map((tag) => ({ ...tag, groupId: group.id, groupName: group.name, id: `${group.id}:${tag.id}` }))); }
});

async function bootstrap() {
  bindEvents();
  await loadAccounts();
  setInterval(() => { if (state.account) loadAlerts().catch(handleError); }, 5_000);
}

async function loadAccounts(preferredId = state.account?.id) {
  const data = await api("/api/accounts");
  state.accounts = data.items;
  const requestedId = new URLSearchParams(location.search).get("account");
  state.account = state.accounts.find((item) => item.id === (preferredId || requestedId)) || state.accounts.find((item) => item.enabled) || state.accounts[0] || null;
  renderAccounts();
  setTab(state.activeTab, false);
  els.emptyState.hidden = Boolean(state.account);
  document.querySelector(".workspace-head").hidden = !state.account;
  document.querySelectorAll("[data-panel]").forEach((panel) => { panel.hidden = !state.account || panel.dataset.panel !== state.activeTab; });
  if (state.account) await loadAccountContext();
}

function renderAccounts() {
  els.accountCount.textContent = `${state.accounts.length} 个`;
  els.accountList.innerHTML = state.accounts.map((account) => `
    <article class="bot-card ${account.enabled ? "is-online" : "is-offline"} is-unlocked ${account.id === state.account?.id ? "is-selected" : ""}" data-account-id="${escapeHtml(account.id)}" style="--bot-accent:${escapeHtml(account.accent)}">
      <div class="bot-main">
        <span class="bot-identity"><span class="bot-identity-content"><img class="bot-avatar" src="./assets/bot-avatar.png" alt="" /><span class="bot-summary"><span class="bot-title-row"><strong>${escapeHtml(account.name)}</strong></span><span class="bot-agent">${escapeHtml(account.provider)} · ${account.agentApiKeyConfigured ? escapeHtml(account.agentId || "Agent 已配置") : "未配置 Agent"}</span></span></span></span>
        <span class="pill ${account.enabled ? "ok" : "off"}">${account.enabled ? "运行中" : "已停用"}</span>
      </div>
      <div class="row-actions bot-actions"><button class="secondary icon-button" data-account-tab="sessions" title="客户会话">${icon("users")}</button><button class="secondary icon-button" data-account-tab="flow" title="状态机">${icon("edit")}</button><button class="secondary icon-button" data-account-tab="tags" title="标签">${icon("tag")}</button><button class="secondary icon-button" data-account-tab="config" title="配置">${icon("link")}</button></div>
    </article>
  `).join("");
}

async function selectAccount(id, tab = state.activeTab) {
  if (state.account?.id === id && tab === state.activeTab) return;
  state.account = state.accounts.find((item) => item.id === id) || null;
  state.conversation = null;
  state.alerts = [];
  alertsLoaded = false;
  state.activeTab = tab;
  renderAccounts();
  setTab(tab, false);
  await loadAccountContext();
}

async function loadAccountContext() {
  document.documentElement.classList.add("has-bot-context");
  document.documentElement.style.setProperty("--bot-accent", state.account.accent);
  document.querySelector(".workspace-tabs").classList.add("is-bound");
  document.querySelectorAll(".bot-context-panel").forEach((panel) => panel.classList.add("is-bound"));
  await Promise.all([flowEditor.load(), tagEditor.load()]);
  renderStateOptions();
  await Promise.all([loadAlerts(), loadActiveTab()]);
}

function setTab(tab, load = true) {
  state.activeTab = tab;
  document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  document.querySelectorAll("[data-panel]").forEach((panel) => { panel.hidden = panel.dataset.panel !== tab; });
  if (load && state.account) loadActiveTab().catch(handleError);
}

async function loadActiveTab() {
  const loaders = {
    cockpit: loadDashboard,
    sessions: loadConversations,
    flow: flowEditor.render,
    tags: tagEditor.render,
    push: loadActivationTargets,
    logs: loadAudit,
    config: renderAccountForm
  };
  await loaders[state.activeTab]?.();
}

async function loadDashboard() {
  const [dashboard, alerts] = await Promise.all([
    api(`/api/accounts/${encodeURIComponent(state.account.id)}/dashboard`),
    api(`/api/accounts/${encodeURIComponent(state.account.id)}/alerts`).then((data) => data.items)
  ]);
  els.cockpitTitle.textContent = state.account.name;
  els.healthPill.textContent = state.account.agentApiKeyConfigured ? "Agent 已连接" : "使用兜底回复";
  els.healthPill.className = `pill ${state.account.agentApiKeyConfigured ? "ok" : "off"}`;
  const metrics = [
    ["message", "全部会话", dashboard.conversations],
    ["clock", "今日消息", dashboard.messagesToday],
    ["alert", "待处理", dashboard.openAlerts],
    ["user", "人工接待", dashboard.humanCount],
    ["users", "未读会话", dashboard.unreadCount]
  ];
  els.metricGrid.innerHTML = metrics.map(([glyph, label, value]) => `<article class="cockpit-metric-card"><span class="cockpit-metric-label">${icon(glyph)}<span>${label}</span></span><strong>${value}</strong></article>`).join("");
  const max = Math.max(1, ...dashboard.states.map((item) => Number(item.count)));
  els.stateBreakdown.innerHTML = dashboard.states.length ? dashboard.states.map((item) => `<div class="state-row"><span>${escapeHtml(stateName(item.state))}</span><span class="state-track"><i style="width:${Math.max(5, Number(item.count) / max * 100)}%"></i></span><strong>${item.count}</strong></div>`).join("") : `<div class="empty-state">暂无会话状态数据</div>`;
  els.dashboardAlerts.innerHTML = alerts.length ? alerts.slice(0, 5).map(alertMarkup).join("") : `<div class="empty-state">当前没有待处理提醒</div>`;
}

function renderStateOptions() {
  const options = (state.machine.config?.nodes || []).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  els.conversationStateFilter.innerHTML = `<option value="">全部状态</option>${options}`;
  els.chatState.innerHTML = options;
}

async function loadConversations({ keepSelection = true } = {}) {
  const params = new URLSearchParams();
  if (els.conversationSearch.value.trim()) params.set("query", els.conversationSearch.value.trim());
  if (els.conversationStateFilter.value) params.set("state", els.conversationStateFilter.value);
  if (els.conversationModeFilter.value) params.set("mode", els.conversationModeFilter.value);
  const data = await api(`/api/accounts/${encodeURIComponent(state.account.id)}/conversations?${params}`);
  state.conversations = data.items;
  if (!keepSelection || !state.conversations.some((item) => item.id === state.conversation?.id)) state.conversation = null;
  renderConversationList();
  els.conversationSummary.textContent = `共 ${state.conversations.length} 个会话`;
  if (state.conversation) await openConversation(state.conversation.id, false);
}

function renderConversationList() {
  els.conversationList.innerHTML = state.conversations.length ? state.conversations.map((conversation) => `
    <button class="flow-session-card ${conversation.id === state.conversation?.id ? "selected" : ""} ${conversation.mode === "human" ? "is-handoff" : ""}" data-conversation-id="${conversation.id}" type="button">
      <span class="flow-session-avatar-shell"><img class="flow-session-avatar" src="./assets/ddeer.png" alt="" /></span>
      <span class="flow-session-main"><span class="flow-session-name-row"><strong class="flow-session-name">${escapeHtml(conversation.displayName)}</strong></span></span>
      <span class="session-badges">${conversation.alertCount ? `<span class="pill off">待处理</span>` : ""}${conversation.unreadCount ? `<span class="unread-dot">${conversation.unreadCount}</span>` : ""}</span>
      <span class="flow-session-tag-zone"><span class="session-last-message">${escapeHtml(conversation.lastMessage || "暂无消息")}</span><span class="conversation-metadata-flow">${renderTagChips(conversation.tags)}<span class="tag-chip">${escapeHtml(stateName(conversation.state))}</span></span></span>
    </button>
  `).join("") : `<div class="empty-state">暂无匹配会话</div>`;
}

async function openConversation(id, markSelected = true) {
  const conversation = await api(`/api/conversations/${id}`);
  state.conversation = conversation;
  if (markSelected) renderConversationList();
  const [data, events] = await Promise.all([
    api(`/api/conversations/${id}/messages`),
    api(`/api/conversations/${id}/flow-events`)
  ]);
  els.chatTitle.textContent = conversation.displayName;
  els.chatState.disabled = false;
  els.chatState.value = conversation.state;
  els.chatTags.innerHTML = `${renderTagChips(conversation.tags)}<button class="tag-chip tag-add-button" type="button" title="添加标签">${icon("plus")}</button>`;
  els.handoffSwitch.hidden = false;
  els.handoffSwitch.classList.toggle("is-human", conversation.mode === "human");
  els.handoffSwitch.setAttribute("aria-checked", String(conversation.mode === "human"));
  els.manualReplyComposer.hidden = false;
  els.manualReplyComposer.classList.toggle("is-ai", conversation.mode === "ai");
  els.manualReplyComposer.querySelector(".ai-takeover-card").hidden = conversation.mode !== "ai";
  els.manualReplyComposer.querySelector(".manual-reply-box").hidden = conversation.mode !== "human";
  renderMessages(data.items);
  els.flowEventsOutput.textContent = JSON.stringify({
    currentNodeId: conversation.flowSession?.currentNodeId || conversation.state,
    status: conversation.flowSession?.status || "active",
    collectedData: conversation.flowSession?.collectedData || {},
    events: events.items
  }, null, 2);
  await loadConversationsQuietly();
}

async function loadConversationsQuietly() {
  const data = await api(`/api/accounts/${encodeURIComponent(state.account.id)}/conversations`);
  state.conversations = data.items;
  renderConversationList();
}

function renderMessages(messages) {
  els.chatMessages.innerHTML = messages.length ? messages.map((message) => {
    const outbound = message.direction === "outbound";
    const sender = outbound ? (message.senderType === "human" ? "人工客服" : "AI 客服") : state.conversation.displayName;
    return `<div class="chat-bubble-row ${outbound ? "outbound" : "inbound"}" data-message-id="${message.id}">${outbound ? "" : `<img class="chat-avatar" src="./assets/ddeer.png" alt="" />`}<div class="chat-bubble"><div class="chat-meta"><small>${escapeHtml(sender)}</small><time>${escapeHtml(formatDate(message.createdAt))}</time></div><div class="chat-text">${escapeHtml(message.content)}</div>${outbound ? `<div class="chat-delivery">${escapeHtml(deliveryLabel(message.deliveryStatus))}</div>` : ""}</div>${outbound ? `<img class="chat-avatar" src="./assets/bot-avatar.png" alt="" />` : ""}</div>`;
  }).join("") : `<div class="empty-state">暂无会话记录</div>`;
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

async function toggleHandoff() {
  if (!state.conversation) return;
  const mode = state.conversation.mode === "human" ? "ai" : "human";
  state.conversation = await api(`/api/conversations/${state.conversation.id}/mode`, { method: "PUT", body: { mode, operator: "console" } });
  await openConversation(state.conversation.id);
  showToast(mode === "human" ? "已切换为人工接待" : "已交还 AI 接待");
}

async function sendManual(event) {
  event.preventDefault();
  const content = els.manualReplyInput.value.trim();
  if (!content || !state.conversation) return;
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await api(`/api/conversations/${state.conversation.id}/messages`, { method: "POST", body: { content, operator: "console" } });
    els.manualReplyInput.value = "";
    await openConversation(state.conversation.id);
  } finally { button.disabled = false; }
}

async function addConversationTag() {
  if (!state.conversation) return;
  let dialog = document.querySelector("#manualTagDialog");
  if (!dialog) {
    dialog = document.createElement("div");
    dialog.id = "manualTagDialog";
    dialog.className = "modal-backdrop";
    document.body.append(dialog);
  }
  const selected = new Set(state.conversation.tags.filter((tag) => tag.groupId !== "date").map((tag) => `${tag.groupId}:${tag.tagId}`));
  const groups = Map.groupBy(state.tags.filter((tag) => tag.enabled !== false), (tag) => tag.groupId);
  dialog.innerHTML = `<div class="confirm-dialog manual-tag-dialog" role="dialog" aria-modal="true"><div class="confirm-icon">${icon("tag")}</div><div class="confirm-copy"><strong>调整客户标签</strong><div class="manual-tag-groups">${[...groups].map(([groupId, tags]) => `<fieldset><legend>${escapeHtml(tags[0]?.groupName || groupId)}</legend>${tags.map((tag) => { const key = `${groupId}:${tag.id.split(":").at(-1)}`; return `<label class="target-option"><input type="checkbox" value="${escapeHtml(key)}" ${selected.has(key) ? "checked" : ""} /><span>${escapeHtml(tag.name)}</span></label>`; }).join("")}</fieldset>`).join("")}</div></div><div class="confirm-actions"><button class="secondary" data-manual-tag-cancel type="button">取消</button><button class="primary" data-manual-tag-save type="button">${icon("save")}保存</button></div></div>`;
  dialog.hidden = false;
  const accepted = await new Promise((resolve) => {
    dialog.onclick = (event) => {
      if (event.target === dialog || event.target.closest("[data-manual-tag-cancel]")) resolve(false);
      if (event.target.closest("[data-manual-tag-save]")) resolve(true);
    };
  });
  dialog.hidden = true;
  if (!accepted) return;
  const next = new Set([...dialog.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value));
  const add = [...next].filter((key) => !selected.has(key)).map((key) => { const [groupId, tagId] = key.split(":"); return { groupId, tagId, reason: "控制台人工调整" }; });
  const remove = [...selected].filter((key) => !next.has(key)).map((key) => { const [groupId, tagId] = key.split(":"); return { groupId, tagId, reason: "控制台人工调整" }; });
  await api(`/api/conversations/${state.conversation.id}/tags`, { method: "POST", body: { decision: { add, remove } } });
  await openConversation(state.conversation.id);
}

async function loadActivationTargets() {
  const data = await api(`/api/accounts/${encodeURIComponent(state.account.id)}/conversations`);
  els.activationTargets.innerHTML = data.items.length ? data.items.map((conversation) => `<label class="target-option"><input type="checkbox" name="conversationIds" value="${conversation.id}" /><strong>${escapeHtml(conversation.displayName)}</strong><small>${escapeHtml(stateName(conversation.state))}</small></label>`).join("") : `<div class="empty-state">暂无可激活会话</div>`;
}

async function sendActivation(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const conversationIds = form.getAll("conversationIds").map(Number);
  const content = String(form.get("content") || "").trim();
  const result = await api(`/api/accounts/${encodeURIComponent(state.account.id)}/activation`, { method: "POST", body: { conversationIds, content } });
  const succeeded = result.items.filter((item) => item.ok).length;
  showToast(`已提交 ${succeeded}/${result.items.length} 个会话`);
}

async function loadAudit() {
  const data = await api(`/api/accounts/${encodeURIComponent(state.account.id)}/audit`);
  els.auditList.innerHTML = data.items.length ? data.items.map((item) => `<article class="audit-item"><time>${escapeHtml(formatDate(item.createdAt))}</time><span class="pill">${escapeHtml(item.category)}</span><strong>${escapeHtml(item.action)}</strong><code>${escapeHtml(JSON.stringify(item.detail))}</code></article>`).join("") : `<div class="empty-state">暂无审计记录</div>`;
}

function renderAccountForm() {
  const form = els.accountForm;
  const fields = form.elements;
  fields.namedItem("name").value = state.account.name;
  fields.namedItem("accent").value = state.account.accent;
  fields.namedItem("agentApiUrl").value = state.account.agentApiUrl;
  fields.namedItem("agentId").value = state.account.agentId;
  fields.namedItem("agentApiKey").value = "";
  fields.namedItem("agentApiKey").placeholder = state.account.agentApiKeyConfigured ? "已配置；留空保持不变" : "请输入 API Key";
  fields.namedItem("webhookSecret").value = "";
  fields.namedItem("webhookSecret").placeholder = state.account.webhookSecretConfigured ? "已配置；留空保持不变" : "可选";
  fields.namedItem("enabled").checked = state.account.enabled;
  const base = location.origin;
  els.inboundEndpoint.textContent = `POST ${base}/api/channels/${state.account.provider}/${state.account.id}/events`;
  els.outboxEndpoint.textContent = `GET ${base}/api/channels/${state.account.provider}/${state.account.id}/conversations/{conversationId}/outbox?after=0`;
}

async function saveAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = form.elements;
  const body = { name: fields.namedItem("name").value, accent: fields.namedItem("accent").value, agentApiUrl: fields.namedItem("agentApiUrl").value, agentId: fields.namedItem("agentId").value, enabled: fields.namedItem("enabled").checked };
  if (fields.namedItem("agentApiKey").value) body.agentApiKey = fields.namedItem("agentApiKey").value;
  if (fields.namedItem("webhookSecret").value) body.webhookSecret = fields.namedItem("webhookSecret").value;
  const updated = await api(`/api/accounts/${encodeURIComponent(state.account.id)}`, { method: "PUT", body });
  state.account = updated;
  await loadAccounts(updated.id);
  showToast("渠道配置已保存");
}

async function loadAlerts() {
  const previousIds = new Set(state.alerts.map((item) => item.id));
  state.alerts = (await api(`/api/accounts/${encodeURIComponent(state.account.id)}/alerts`)).items;
  if (alertsLoaded) {
    const fresh = state.alerts.find((item) => !previousIds.has(item.id));
    if (fresh) {
      const audio = fresh.title.startsWith("标签提醒：") ? els.tagVoiceAlertAudio : els.attentionAlertAudio;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  }
  alertsLoaded = true;
  els.alertCount.textContent = String(state.alerts.length);
  els.alertCount.hidden = !state.alerts.length;
  els.alertList.innerHTML = state.alerts.length ? state.alerts.map((alert) => `${alertMarkup(alert)}<button class="secondary resolve-alert" data-alert-id="${alert.id}">${icon("check")}标记已处理</button>`).join("") : `<div class="empty-state">当前没有待处理提醒</div>`;
}

function alertMarkup(alert) {
  return `<article class="dashboard-alert" data-alert-conversation="${alert.conversationId}"><strong>${escapeHtml(alert.title)}</strong><span>${escapeHtml(alert.displayName || "")}</span><small>${escapeHtml(alert.detail || "")}</small><time>${escapeHtml(formatDate(alert.createdAt))}</time></article>`;
}

function renderTagChips(tags = []) {
  return tags.map((tag) => `<span class="tag-chip" style="border-color:${escapeHtml(tag.color)};color:${escapeHtml(tag.color)}">${icon("tag")}<span>${escapeHtml(tag.name)}</span></span>`).join("");
}

function stateName(id) {
  return (state.machine.config?.nodes || []).find((item) => item.id === id)?.name || id || "未设置";
}

function deliveryLabel(status) {
  return ({ pending: "发送中", queued: "已进入渠道队列", sent: "已发送", delivered: "已送达", read: "已读", failed: "发送失败" })[status] || status;
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
  document.querySelectorAll("[data-go-tab]").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.goTab)));
  els.accountList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-account-id]");
    if (!card) return;
    const tab = event.target.closest("[data-account-tab]")?.dataset.accountTab || state.activeTab;
    selectAccount(card.dataset.accountId, tab).catch(handleError);
  });
  els.refreshButton.addEventListener("click", () => loadAccountContext().then(() => showToast("数据已刷新")).catch(handleError));
  els.refreshConversations.addEventListener("click", () => loadConversations().catch(handleError));
  let searchTimer;
  els.conversationSearch.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadConversations({ keepSelection: false }).catch(handleError), 250); });
  els.conversationStateFilter.addEventListener("change", () => loadConversations({ keepSelection: false }).catch(handleError));
  els.conversationModeFilter.addEventListener("change", () => loadConversations({ keepSelection: false }).catch(handleError));
  els.conversationList.addEventListener("click", (event) => { const card = event.target.closest("[data-conversation-id]"); if (card) openConversation(Number(card.dataset.conversationId)).catch(handleError); });
  els.handoffSwitch.addEventListener("click", () => toggleHandoff().catch(handleError));
  els.handoffSwitch.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); toggleHandoff().catch(handleError); } });
  els.chatState.addEventListener("change", async () => { if (!state.conversation) return; state.conversation = await api(`/api/conversations/${state.conversation.id}/state`, { method: "PUT", body: { state: els.chatState.value } }); await loadConversations(); showToast("会话状态已更新"); });
  els.chatTags.addEventListener("click", (event) => { if (event.target.closest(".tag-add-button")) addConversationTag().catch(handleError); });
  els.manualReplyComposer.addEventListener("submit", (event) => sendManual(event).catch(handleError));
  els.activationForm.addEventListener("submit", (event) => sendActivation(event).catch(handleError));
  els.refreshAudit.addEventListener("click", () => loadAudit().catch(handleError));
  els.accountForm.addEventListener("submit", (event) => saveAccount(event).catch(handleError));
  els.alertButton.addEventListener("click", () => { els.alertPanel.hidden = !els.alertPanel.hidden; });
  els.closeAlerts.addEventListener("click", () => { els.alertPanel.hidden = true; });
  els.alertList.addEventListener("click", async (event) => {
    const resolve = event.target.closest("[data-alert-id]");
    if (resolve) { await api(`/api/alerts/${resolve.dataset.alertId}/resolve`, { method: "PUT" }); await loadAlerts(); return; }
    const alert = event.target.closest("[data-alert-conversation]");
    if (alert) { setTab("sessions"); await loadConversations(); await openConversation(Number(alert.dataset.alertConversation)); els.alertPanel.hidden = true; }
  });
  els.openAlertFilter.addEventListener("click", () => { els.conversationModeFilter.value = "human"; loadConversations({ keepSelection: false }).catch(handleError); });
}

function handleError(error) {
  console.error(error);
  showToast(error.message || String(error), true);
}

bootstrap().catch(handleError);
