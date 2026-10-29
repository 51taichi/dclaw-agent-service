import { createFlowEditor } from "./flow-editor.js";
import { createTagEditor } from "./tag-editor.js";

const state = {
  accounts: [],
  employees: [],
  employee: null,
  account: null,
  activeTab: ["cockpit", "sessions", "flow", "tags", "push", "config"].includes(new URLSearchParams(location.search).get("tab")) ? new URLSearchParams(location.search).get("tab") : "cockpit",
  conversations: [],
  conversation: null,
  conversationPage: 1,
  conversationPageSize: 20,
  manualReplyFiles: [],
  machine: { enabled: false, config: { entryNodeId: "", nodes: [] } },
  tags: [],
  alerts: []
};

const els = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.getAttribute("id"), element]));
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
const TOAST_CONFIG = {
  success: { type: "success", icon: "check" },
  error: { type: "error", icon: "alert" },
  info: { type: "info", icon: "info" }
};
const MANUAL_REPLY_EMOJIS = ["😊", "👌", "👍", "🙏", "😄", "🎉", "✨", "💪"];
const MANUAL_REPLY_MAX_ATTACHMENTS = 5;
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

function inferToastType(message) {
  const text = String(message || "");
  if (/失败|错误|不正确|异常|不可用|无权限|需要|请先|请选择|请输入|不能|暂无/.test(text)) return "error";
  if (/^(已|配置已|状态机已)|已(保存|发送|删除|修改|切换|恢复|导入)/.test(text)) return "success";
  return "info";
}

function showToast(message, tone = "") {
  const type = tone === true ? "error" : typeof tone === "string" && TOAST_CONFIG[tone] ? tone : inferToastType(message);
  const config = TOAST_CONFIG[type];
  els.toast.className = `toast toast-${config.type}`;
  els.toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${icon(config.icon)}</span><span class="toast-message">${escapeHtml(message)}</span>`;
  els.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { els.toast.hidden = true; }, 3200);
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
  renderManualReplyEmojiBar();
  await loadAccounts();
  setInterval(() => { if (state.account) loadAlerts().catch(handleError); }, 5_000);
}

async function loadAccounts(preferredId = state.account?.id) {
  const workspaceId = new URLSearchParams(location.search).get("workspace") || "";
  const data = await api(`/api/accounts${workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : ""}`);
  state.accounts = data.items;
  state.employees = groupEmployeeAccounts(state.accounts);
  const requestedId = new URLSearchParams(location.search).get("account");
  const preferredAccount = state.accounts.find((item) => item.id === (preferredId || requestedId));
  state.employee = state.employees.find((item) => item.accounts.some((account) => account.id === preferredAccount?.id))
    || state.employees.find((item) => item.accounts.some((account) => account.enabled))
    || state.employees[0]
    || null;
  state.account = state.employee?.accounts.find((item) => item.id === preferredAccount?.id)
    || state.employee?.accounts.find((item) => item.enabled)
    || state.employee?.accounts[0]
    || null;
  renderAccounts();
  renderConversationChannelTabs();
  setTab(state.activeTab, false);
  els.emptyState.hidden = Boolean(state.account);
  document.querySelector(".workspace-head").hidden = !state.account;
  document.querySelectorAll("[data-panel]").forEach((panel) => { panel.hidden = !state.account || panel.dataset.panel !== state.activeTab; });
  if (state.account) await loadAccountContext();
}

function groupEmployeeAccounts(accounts) {
  const employeeAccounts = accounts.filter((account) => account.personId && account.person);
  const source = employeeAccounts.length ? employeeAccounts : accounts;
  const groups = new Map();
  for (const account of source) {
    const id = account.personId || `account:${account.id}`;
    if (!groups.has(id)) groups.set(id, { id, person: account.person, accounts: [] });
    groups.get(id).accounts.push(account);
  }
  return [...groups.values()].map((employee) => ({
    ...employee,
    accounts: employee.accounts.sort((left, right) => channelOrder(left.provider) - channelOrder(right.provider) || left.name.localeCompare(right.name, "zh-CN")),
    enabledCount: employee.accounts.filter((account) => account.enabled).length
  }));
}

function channelOrder(provider) { return ({ website: 1, miniapp: 2 })[provider] || 99; }
function channelLabel(provider) { return provider === "miniapp" ? "智能名片" : provider === "website" ? "官网客服" : provider; }
function channelIcon(provider) { return provider === "miniapp" ? "phone" : "monitor"; }

function renderAccounts() {
  els.accountCount.textContent = `${state.employees.length} 个`;
  els.accountList.innerHTML = state.employees.map((employee) => {
    const representative = employee.accounts.find((account) => account.enabled) || employee.accounts[0];
    const person = employee.person || representative.person;
    const agentIds = [...new Set(employee.accounts.map((account) => account.agentId).filter(Boolean))];
    return `
    <article class="bot-card ${employee.enabledCount ? "is-online" : "is-offline"} is-unlocked ${employee.id === state.employee?.id ? "is-selected" : ""}" data-employee-id="${escapeHtml(employee.id)}" style="--bot-accent:${escapeHtml(representative.accent)}">
      <div class="bot-main">
        <span class="bot-identity"><span class="bot-identity-content"><img class="bot-avatar" src="${escapeHtml(person?.avatarUrl || "./assets/bot-avatar.png")}" alt="" /><span class="bot-summary"><span class="bot-title-row"><strong>${escapeHtml(person?.name || representative.name)}</strong></span><span class="bot-agent">${escapeHtml(person?.title || representative.workspace?.name || "智能员工")} · ${agentIds.length ? escapeHtml(agentIds.join("、")) : "继承配置未完成"}</span></span></span></span>
        <span class="employee-channel-badges">${employee.accounts.map((account) => `<em class="channel-badge is-${escapeHtml(account.provider)}">${escapeHtml(channelLabel(account.provider))}</em>`).join("")}</span>
      </div>
      <div class="row-actions bot-actions"><button class="secondary icon-button" data-account-tab="sessions" title="客户会话">${icon("users")}</button><button class="secondary icon-button" data-account-tab="flow" title="状态机">${icon("edit")}</button><button class="secondary icon-button" data-account-tab="tags" title="标签">${icon("tag")}</button><button class="secondary icon-button" data-account-tab="config" title="配置">${icon("link")}</button></div>
    </article>
  `; }).join("");
}

async function selectEmployee(id, tab = state.activeTab) {
  const employee = state.employees.find((item) => item.id === id) || null;
  if (!employee) return;
  if (state.employee?.id === id && tab === state.activeTab) return;
  const previousProvider = state.account?.provider;
  state.employee = employee;
  state.account = employee.accounts.find((item) => item.provider === previousProvider && item.enabled)
    || employee.accounts.find((item) => item.enabled)
    || employee.accounts[0]
    || null;
  state.conversation = null;
  clearManualReplyFiles();
  state.alerts = [];
  alertsLoaded = false;
  state.activeTab = tab;
  renderAccounts();
  renderConversationChannelTabs();
  setTab(tab, false);
  await loadAccountContext();
}

async function selectEmployeeChannel(accountId) {
  const account = state.employee?.accounts.find((item) => item.id === accountId);
  if (!account || account.id === state.account?.id) return;
  state.account = account;
  state.conversation = null;
  state.conversationPage = 1;
  clearManualReplyFiles();
  state.alerts = [];
  alertsLoaded = false;
  renderConversationChannelTabs();
  clearConversationView();
  await loadAccountContext();
}

function renderConversationChannelTabs() {
  if (!els.conversationChannelTabs) return;
  const accounts = state.employee?.accounts || [];
  els.conversationChannelTabs.style.setProperty("--channel-count", Math.max(1, accounts.length));
  els.conversationChannelTabs.innerHTML = accounts.map((account) => `<button class="channel-conversation-tab is-${escapeHtml(account.provider)} ${account.id === state.account?.id ? "active" : ""}" data-channel-account-id="${escapeHtml(account.id)}" type="button" role="tab" aria-selected="${account.id === state.account?.id}">${icon(channelIcon(account.provider))}<span>${escapeHtml(channelLabel(account.provider))}</span></button>`).join("");
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
    config: renderAccountForm
  };
  await loaders[state.activeTab]?.();
}

async function loadDashboard() {
  const dashboard = await api(`/api/accounts/${encodeURIComponent(state.account.id)}/dashboard`);
  const personName = state.employee?.person?.name || state.account.person?.name || state.account.name;
  els.cockpitTitle.textContent = `${personName} · 经营驾驶舱`;
  els.cockpitScopeChannels.innerHTML = dashboard.channels.map((channel) => `<span class="dashboard-channel-chip is-${escapeHtml(channel.provider)}">${icon(channelIcon(channel.provider))}${escapeHtml(channelLabel(channel.provider))}</span>`).join("");
  const successRate = dashboard.agent.successRate;
  els.healthPill.textContent = successRate == null ? "近 7 日暂无 Agent 调用" : `Agent 成功率 ${formatPercent(successRate)}`;
  els.healthPill.className = `pill ${successRate == null ? "off" : successRate >= 95 ? "ok" : successRate >= 80 ? "selected" : "bad"}`;
  const metrics = [
    ["users", "今日访客", dashboard.today.visitors, `累计 ${dashboard.totals.conversations} 位客户`, "visitor"],
    ["message", "客户消息", dashboard.today.inboundMessages, "今日主动咨询", "message"],
    ["robot", "AI 回复", dashboard.today.agentReplies, "今日自动接待", "agent"],
    ["briefcase", "有效留资", dashboard.totals.leads, dashboard.today.leads ? `今日新增 ${dashboard.today.leads}` : "已收集客户信息", "lead"],
    ["alert", "待人工跟进", dashboard.totals.openAlerts, `${dashboard.totals.activeHuman} 个正在人工接待`, "attention"]
  ];
  els.metricGrid.innerHTML = metrics.map(([glyph, label, value, hint, tone]) => `<article class="cockpit-metric-card is-${tone}"><span class="cockpit-metric-icon">${icon(glyph)}</span><span class="cockpit-metric-copy"><span>${label}</span><small>${escapeHtml(hint)}</small></span><strong>${value}</strong></article>`).join("");
  renderDashboardTrend(dashboard.trend);
  renderAgentQuality(dashboard);
  const max = Math.max(1, ...dashboard.states.map((item) => Number(item.count)));
  const totalStates = Math.max(1, dashboard.states.reduce((sum, item) => sum + Number(item.count), 0));
  els.stateBreakdown.innerHTML = dashboard.states.length ? dashboard.states.map((item) => `<div class="state-row"><span>${escapeHtml(stateName(item.state))}</span><span class="state-track"><i style="width:${Math.max(5, Number(item.count) / max * 100)}%"></i></span><strong>${item.count}<small>${Math.round(Number(item.count) / totalStates * 100)}%</small></strong></div>`).join("") : `<div class="empty-state compact-empty">暂无客户阶段数据</div>`;
  els.dashboardAlerts.innerHTML = dashboard.alerts.length ? dashboard.alerts.map((alert) => `<button class="business-alert-row" type="button" data-dashboard-alert-account="${escapeHtml(alert.accountId)}" data-dashboard-alert-conversation="${alert.conversationId}"><span class="business-alert-channel is-${escapeHtml(alert.provider)}">${icon(channelIcon(alert.provider))}</span><span><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.displayName || "访客")} · ${escapeHtml(formatDate(alert.createdAt))}</small></span><svg class="icon business-alert-arrow"><use href="#icon-chevron"></use></svg></button>`).join("") : `<div class="empty-state compact-empty">当前没有待跟进事项</div>`;
  els.channelPerformance.innerHTML = dashboard.channels.map(channelPerformanceMarkup).join("") || `<div class="empty-state compact-empty">暂无渠道数据</div>`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(Number(value) % 1 ? 1 : 0)}%`;
}

function formatDuration(milliseconds) {
  if (!milliseconds) return "--";
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds >= 10_000 ? 1 : 2)} 秒`;
}

function renderDashboardTrend(items = []) {
  const max = Math.max(1, ...items.flatMap((item) => [item.visitors, item.messages]));
  els.trendChart.innerHTML = items.map((item) => {
    const date = new Date(`${item.day}T00:00:00`);
    const dayLabel = `${date.getMonth() + 1}/${date.getDate()}`;
    const visitorHeight = item.visitors ? Math.max(8, item.visitors / max * 100) : 2;
    const messageHeight = item.messages ? Math.max(8, item.messages / max * 100) : 2;
    return `<div class="trend-day"><div class="trend-bars"><i class="visitor" style="height:${visitorHeight}%" title="新访客 ${item.visitors}"></i><i class="message" style="height:${messageHeight}%" title="客户消息 ${item.messages}"></i></div><span>${dayLabel}</span><small>${item.visitors}/${item.messages}</small></div>`;
  }).join("");
}

function renderAgentQuality(dashboard) {
  const rate = dashboard.agent.successRate;
  const progress = rate == null ? 0 : Math.max(0, Math.min(100, rate));
  els.agentQuality.innerHTML = `<div class="agent-quality-score"><span><strong>${rate == null ? "--" : formatPercent(rate)}</strong><small>请求成功率</small></span><div class="agent-quality-track"><i style="width:${progress}%"></i></div></div><dl><div><dt>调用次数</dt><dd>${dashboard.agent.requests}</dd></div><div><dt>平均响应</dt><dd>${formatDuration(dashboard.agent.avgDurationMs)}</dd></div><div><dt>失败请求</dt><dd class="${dashboard.agent.failed ? "is-warning" : ""}">${dashboard.agent.failed}</dd></div><div><dt>今日转人工</dt><dd>${dashboard.today.handoffs}</dd></div></dl>`;
}

function channelPerformanceMarkup(channel) {
  return `<article class="channel-performance-card is-${escapeHtml(channel.provider)}"><div class="channel-performance-head"><span class="channel-performance-icon">${icon(channelIcon(channel.provider))}</span><span><strong>${escapeHtml(channelLabel(channel.provider))}</strong><small>${channel.enabled ? "已启用" : "已停用"}</small></span><button class="secondary compact-button" type="button" data-dashboard-channel="${escapeHtml(channel.accountId)}">查看会话</button></div><div class="channel-performance-metrics"><span><small>今日访客</small><strong>${channel.visitorsToday}</strong></span><span><small>客户消息</small><strong>${channel.messagesToday}</strong></span><span><small>留资客户</small><strong>${channel.leads}</strong></span><span><small>待跟进</small><strong>${channel.openAlerts}</strong></span><span><small>Agent 成功率</small><strong>${channel.agentSuccessRate == null ? "--" : formatPercent(channel.agentSuccessRate)}</strong></span></div></article>`;
}

async function openDashboardChannel(accountId) {
  if (accountId && accountId !== state.account?.id) await selectEmployeeChannel(accountId);
  setTab("sessions", false);
  await loadConversations({ keepSelection: false, resetPage: true });
}

async function openDashboardConversation(accountId, conversationId) {
  if (accountId && accountId !== state.account?.id) await selectEmployeeChannel(accountId);
  setTab("sessions", false);
  await loadConversations({ keepSelection: false, resetPage: true });
  if (conversationId) await openConversation(conversationId);
}

function renderStateOptions() {
  const options = (state.machine.config?.nodes || []).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  els.conversationStateFilter.innerHTML = `<option value="">全部状态</option>${options}`;
  renderConversationTagOptions();
}

function conversationTagKey(tag) {
  const tagId = tag.tagId || String(tag.id || "").split(":").at(-1);
  return `${tag.groupId || ""}:${tagId || ""}`;
}

function renderConversationTagOptions() {
  const selected = new Set([...els.conversationTagFilter.selectedOptions].map((option) => option.value));
  const tags = state.tags.filter((tag) => tag.enabled !== false && tag.groupId !== "date");
  els.conversationTagFilter.innerHTML = tags.map((tag) => {
    const value = conversationTagKey(tag);
    return `<option value="${escapeHtml(value)}" ${selected.has(value) ? "selected" : ""}>${escapeHtml(tag.name)}</option>`;
  }).join("");
  const groups = Map.groupBy(tags, (tag) => tag.groupName || "未分组标签");
  els.conversationTagFilterMenu.innerHTML = tags.length ? [...groups].map(([groupName, items]) => `<span class="tag-multi-select-group-label">${escapeHtml(groupName)}</span>${items.map((tag) => {
    const value = conversationTagKey(tag);
    const checked = selected.has(value);
    return `<label class="tag-multi-select-option" aria-selected="${checked}"><input type="checkbox" value="${escapeHtml(value)}" ${checked ? "checked" : ""} /><span>${escapeHtml(tag.name)}</span></label>`;
  }).join("")}`).join("") : `<span class="tag-multi-select-empty">暂无可选标签</span>`;
  const selectedLabels = tags.filter((tag) => selected.has(conversationTagKey(tag))).map((tag) => tag.name);
  els.conversationTagFilterButton.textContent = selectedLabels.length ? selectedLabels.join("、") : "选择标签";
}

function localDateKey(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function compactDateLabel(conversation) {
  const dateTag = conversation.tags?.find((tag) => tag.groupId === "date");
  if (dateTag?.name) return dateTag.name;
  return localDateKey(conversation.lastMessageAt || conversation.updatedAt).replaceAll("-", "");
}

function conversationQueryParams() {
  const params = new URLSearchParams();
  if (els.conversationSearch.value.trim()) params.set("query", els.conversationSearch.value.trim());
  if (els.conversationStateFilter.value) params.set("state", els.conversationStateFilter.value);
  return params;
}

async function fetchFilteredConversations() {
  const params = conversationQueryParams();
  const data = await api(`/api/accounts/${encodeURIComponent(state.account.id)}/conversations?${params}`);
  const dateFilter = els.conversationDateFilter.value.replaceAll("-", "");
  const tagFilters = new Set([...els.conversationTagFilter.selectedOptions].map((option) => option.value));
  return data.items.filter((conversation) => {
    if (dateFilter && !conversation.tags?.some((tag) => tag.groupId === "date" && String(tag.tagId || tag.name || "").replace(/\D/g, "") === dateFilter)) return false;
    if (tagFilters.size && !conversation.tags?.some((tag) => tagFilters.has(conversationTagKey(tag)))) return false;
    return true;
  });
}

function conversationPagination() {
  const total = state.conversations.length;
  const totalPages = Math.max(1, Math.ceil(total / state.conversationPageSize));
  state.conversationPage = Math.min(Math.max(1, state.conversationPage), totalPages);
  return { total, totalPages, page: state.conversationPage, pageSize: state.conversationPageSize };
}

async function loadConversations({ keepSelection = true, resetPage = false } = {}) {
  if (resetPage) state.conversationPage = 1;
  state.conversations = await fetchFilteredConversations();
  if (!keepSelection || !state.conversations.some((item) => item.id === state.conversation?.id)) state.conversation = null;
  renderConversationList();
  renderConversationPagination();
  if (state.conversation) await openConversation(state.conversation.id, false);
  else clearConversationView();
}

function renderConversationList() {
  const pagination = conversationPagination();
  const start = (pagination.page - 1) * pagination.pageSize;
  const conversations = state.conversations.slice(start, start + pagination.pageSize);
  els.conversationList.innerHTML = conversations.length ? conversations.map((conversation) => `
    <article class="flow-session-card ${conversation.id === state.conversation?.id ? "selected" : ""} ${conversation.mode === "human" ? "is-handoff" : ""}" data-conversation-id="${conversation.id}" role="button" tabindex="0" aria-label="打开 ${escapeHtml(conversation.displayName)} 的会话">
      <span class="flow-session-avatar-shell"><img class="flow-session-avatar" src="./assets/ddeer.png" alt="" /></span>
      <span class="flow-session-main"><span class="flow-session-name-row"><strong class="flow-session-name">${escapeHtml(conversation.displayName)}</strong></span></span>
      <span class="flow-session-date-tag"><span class="tag-chip">${icon("tag")}<span>${escapeHtml(compactDateLabel(conversation))}</span></span></span>
      <span class="handoff-switch flow-session-switch ${conversation.mode === "human" ? "is-human" : ""}" data-conversation-mode="${conversation.id}" role="switch" tabindex="0" aria-checked="${conversation.mode === "human"}" aria-label="切换 ${escapeHtml(conversation.displayName)} 的接待模式"><span class="handoff-switch-option is-ai">${icon("robot")}</span><span class="handoff-switch-option is-human">${icon("user")}</span><span class="handoff-switch-thumb"></span></span>
      <button class="flow-session-manual-tag-trigger" data-conversation-tags="${conversation.id}" type="button" title="调整客户标签" aria-label="调整 ${escapeHtml(conversation.displayName)} 的标签">${icon("tag")}</button>
      <span class="flow-session-tag-zone"><span class="conversation-metadata-flow">${renderTagChips((conversation.tags || []).filter((tag) => tag.groupId !== "date"))}${conversation.alertCount ? `<span class="tag-chip">待处理</span>` : ""}${conversation.unreadCount ? `<span class="unread-dot">${conversation.unreadCount}</span>` : ""}</span></span>
      <span class="flow-session-tools"><span class="flow-session-current-task">${escapeHtml(stateName(conversation.state))}</span></span>
    </article>
  `).join("") : `<div class="empty-state">暂无匹配会话</div>`;
}

function renderConversationPagination() {
  const pagination = conversationPagination();
  els.conversationSummary.className = "pagination-bar conversation-pagination";
  els.conversationSummary.innerHTML = `<label class="pagination-size">每页 <select data-conversation-page-size><option value="10" ${pagination.pageSize === 10 ? "selected" : ""}>10</option><option value="20" ${pagination.pageSize === 20 ? "selected" : ""}>20</option><option value="50" ${pagination.pageSize === 50 ? "selected" : ""}>50</option></select></label><span class="conversation-pagination-controls"><button class="secondary pagination-button is-prev" data-conversation-page="${pagination.page - 1}" type="button" aria-label="上一页" ${pagination.page <= 1 ? "disabled" : ""}>${icon("chevron")}</button><span class="pagination-current">第 ${pagination.page} / ${pagination.totalPages} 页</span><button class="secondary pagination-button is-next" data-conversation-page="${pagination.page + 1}" type="button" aria-label="下一页" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>${icon("chevron")}</button><span class="pagination-summary">共 ${pagination.total} 条</span></span>`;
}

function clearConversationView() {
  els.chatTitle.textContent = "请选择一个客户会话";
  els.chatTags.innerHTML = "";
  els.handoffSwitch.hidden = true;
  els.resetConversationButton.disabled = true;
  renderConversationAssets(null);
  els.manualReplyComposer.hidden = true;
  clearManualReplyFiles();
  els.chatMessages.innerHTML = `<div class="empty-state">请选择左侧客户会话</div>`;
  els.flowEventsOutput.textContent = "";
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
  els.chatTags.innerHTML = `${renderTagChips(conversation.tags)}<button class="tag-chip tag-add-button" type="button" title="添加标签">${icon("plus")}</button>`;
  els.handoffSwitch.hidden = false;
  els.resetConversationButton.disabled = false;
  els.handoffSwitch.classList.toggle("is-human", conversation.mode === "human");
  els.handoffSwitch.setAttribute("aria-checked", String(conversation.mode === "human"));
  els.manualReplyComposer.hidden = false;
  els.manualReplyComposer.classList.toggle("is-ai", conversation.mode === "ai");
  els.manualReplyComposer.querySelector(".ai-takeover-card").hidden = conversation.mode !== "ai";
  els.manualReplyComposer.querySelector(".manual-reply-box").hidden = conversation.mode !== "human";
  renderConversationAssets(conversation);
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
  state.conversations = await fetchFilteredConversations();
  renderConversationList();
  renderConversationPagination();
}

function renderMessages(messages) {
  els.chatMessages.innerHTML = messages.length ? messages.map((message) => {
    const outbound = message.direction === "outbound";
    const sender = outbound ? (message.senderType === "human" ? "人工客服" : "AI 客服") : state.conversation.displayName;
    return `<div class="chat-bubble-row ${outbound ? "outbound" : "inbound"}" data-message-id="${message.id}">${outbound ? "" : `<img class="chat-avatar" src="./assets/ddeer.png" alt="" />`}<div class="chat-bubble"><div class="chat-meta"><small>${escapeHtml(sender)}</small><time>${escapeHtml(formatDate(message.createdAt))}</time></div>${message.content ? `<div class="chat-text">${escapeHtml(message.content)}</div>` : ""}${renderMessageAttachments(message.metadata?.attachments)}${renderMessageSources(message.metadata?.sources)}${outbound ? `<div class="chat-delivery">${escapeHtml(deliveryLabel(message.deliveryStatus))}</div>` : ""}</div>${outbound ? `<img class="chat-avatar" src="./assets/bot-avatar.png" alt="" />` : ""}</div>`;
  }).join("") : `<div class="empty-state">暂无会话记录</div>`;
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function renderMessageAttachments(value) {
  const attachments = Array.isArray(value) ? value.filter((item) => item?.url) : [];
  if (!attachments.length) return "";
  return `<div class="chat-attachments" aria-label="附件">${attachments.map((attachment) => {
    const name = attachment.title || attachment.name || attachment.url;
    if (attachment.type === "image") return `<a class="chat-attachment-link chat-media-image-link" href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer"><img class="chat-media-image" src="${escapeHtml(attachment.url)}" alt="${escapeHtml(name)}" loading="lazy" /></a>`;
    if (attachment.type === "card") return `<a class="chat-message-card-link" href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer"><span class="chat-message-card-shell"><span class="chat-message-card-copy"><strong>${escapeHtml(attachment.title || attachment.name || "卡片")}</strong><small>${escapeHtml(attachment.subtitle || "")}</small><span class="chat-message-card-host">${icon("link")}打开资料</span></span><span class="chat-message-card-image ${attachment.pictureUrl ? "" : "chat-message-card-image-fallback"}">${attachment.pictureUrl ? `<img src="${escapeHtml(attachment.pictureUrl)}" alt="" loading="lazy" />` : icon("image")}</span></span></a>`;
    return `<a class="chat-attachment-link" href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a>`;
  }).join("")}</div>`;
}

function renderMessageSources(value) {
  const sources = Array.isArray(value) ? value.filter((item) => item?.type && item?.name) : [];
  if (!sources.length) return "";
  return `<div class="chat-sources">${sources.map((source) => `<span class="chat-source-chip" title="${escapeHtml(source.reason || "")}">${icon("link")}${escapeHtml(source.name)}</span>`).join("")}</div>`;
}

async function toggleHandoff() {
  if (!state.conversation) return;
  const mode = await setConversationMode(state.conversation);
  showToast(mode === "human" ? "已切换为人工接待" : "已交还 AI 接待");
}

async function setConversationMode(conversation) {
  const mode = conversation.mode === "human" ? "ai" : "human";
  const updated = await api(`/api/conversations/${conversation.id}/mode`, { method: "PUT", body: { mode, operator: "console" } });
  if (state.conversation?.id === conversation.id) {
    state.conversation = updated;
    await openConversation(conversation.id);
  } else {
    await loadConversationsQuietly();
  }
  return mode;
}

async function sendManual(event) {
  event.preventDefault();
  const content = els.manualReplyInput.value.trim();
  const files = [...state.manualReplyFiles];
  if ((!content && !files.length) || !state.conversation) return;
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  els.manualReplyAttachmentButton.disabled = true;
  els.manualReplyComposer.classList.toggle("is-uploading", files.length > 0);
  try {
    const attachments = [];
    for (const file of files) attachments.push(await uploadManualReplyFile(file));
    await api(`/api/conversations/${state.conversation.id}/messages`, { method: "POST", body: { content, attachments, operator: "console" } });
    els.manualReplyInput.value = "";
    clearManualReplyFiles();
    await openConversation(state.conversation.id);
    showToast("已发送");
  } finally {
    button.disabled = false;
    els.manualReplyAttachmentButton.disabled = false;
    els.manualReplyComposer.classList.remove("is-uploading");
  }
}

function renderManualReplyEmojiBar() {
  els.manualReplyEmojiBar.innerHTML = MANUAL_REPLY_EMOJIS.map((emoji) => `<button type="button" data-manual-reply-emoji="${emoji}" title="插入 ${emoji}">${emoji}</button>`).join("");
}

function insertManualReplyEmoji(emoji) {
  if (!emoji || els.manualReplyInput.disabled) return;
  const start = els.manualReplyInput.selectionStart ?? els.manualReplyInput.value.length;
  const end = els.manualReplyInput.selectionEnd ?? els.manualReplyInput.value.length;
  els.manualReplyInput.value = `${els.manualReplyInput.value.slice(0, start)}${emoji}${els.manualReplyInput.value.slice(end)}`;
  const position = start + emoji.length;
  els.manualReplyInput.focus();
  els.manualReplyInput.setSelectionRange(position, position);
}

function conversationAssets(conversation) {
  const fields = [...new Set((state.machine.config?.nodes || []).flatMap((node) => node.collectFields || []).map((field) => String(field).trim()).filter(Boolean))];
  const collectedData = conversation?.flowSession?.collectedData || {};
  const items = fields.map((key) => {
    const value = collectedData[key];
    const collected = value !== undefined && value !== null && String(value).trim() !== "";
    return { key, value: collected ? String(value) : "", collected };
  });
  return { fields: items, totalCount: items.length, collectedCount: items.filter((item) => item.collected).length };
}

function renderConversationAssets(conversation) {
  const assets = conversationAssets(conversation);
  els.assetsButton.hidden = !conversation || assets.totalCount === 0;
  els.assetsButton.disabled = !conversation || assets.totalCount === 0;
  els.assetsCount.textContent = `${assets.collectedCount}/${assets.totalCount}`;
  els.assetsPanel.hidden = true;
  els.assetsPanel.innerHTML = assets.totalCount ? `<div class="assets-panel-head"><strong>会话资产</strong><span>${assets.collectedCount}/${assets.totalCount} 已收集</span></div><div class="asset-list">${assets.fields.map((field) => `<div class="asset-row ${field.collected ? "is-collected" : "is-empty"}"><span>${escapeHtml(field.key)}</span><strong>${field.collected ? escapeHtml(field.value) : "未收集"}</strong></div>`).join("")}</div>` : "";
}

function renderManualReplyFiles() {
  els.manualReplyAttachmentList.innerHTML = state.manualReplyFiles.map((file, index) => `<span class="manual-reply-attachment-card" title="${escapeHtml(file.name)}">${icon("upload")}<button class="manual-reply-attachment-remove" data-remove-manual-file="${index}" type="button" aria-label="移除 ${escapeHtml(file.name)}">${icon("reset")}</button></span>`).join("");
}

function setManualReplyFiles(files) {
  const next = [...files].filter((file) => /^(image\/(?:png|jpeg|webp)|video\/(?:mp4|webm))$/.test(file.type));
  const available = MANUAL_REPLY_MAX_ATTACHMENTS - state.manualReplyFiles.length;
  if (available <= 0) return showToast(`最多只能上传 ${MANUAL_REPLY_MAX_ATTACHMENTS} 个附件`, "error");
  state.manualReplyFiles.push(...next.slice(0, available));
  if (next.length > available) showToast(`最多只能上传 ${MANUAL_REPLY_MAX_ATTACHMENTS} 个附件`, "error");
  if (next.length !== [...files].length) showToast("仅支持 PNG、JPEG、WebP、MP4 或 WebM 文件", "error");
  els.manualReplyUploadFile.value = "";
  renderManualReplyFiles();
}

function clearManualReplyFiles() {
  state.manualReplyFiles = [];
  if (els.manualReplyUploadFile) els.manualReplyUploadFile.value = "";
  if (els.manualReplyAttachmentList) renderManualReplyFiles();
}

async function uploadManualReplyFile(file) {
  const response = await fetch("/api/admin/media", {
    method: "POST",
    headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
    body: file
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `附件上传失败 (${response.status})`);
  return data.asset;
}

async function resetConversation() {
  if (!state.conversation) return;
  let dialog = document.querySelector("#conversationResetDialog");
  if (!dialog) {
    dialog = document.createElement("div");
    dialog.id = "conversationResetDialog";
    dialog.className = "modal-backdrop";
    document.body.append(dialog);
  }
  dialog.innerHTML = `<div class="confirm-dialog conversation-reset-dialog" role="dialog" aria-modal="true"><div class="confirm-icon">${icon("reset")}</div><div class="confirm-copy"><strong>删除会话？</strong><p>将清空该客户的消息、标签、任务进度和待处理提醒。客户再次发消息时会重新建立会话。</p></div><div class="confirm-actions"><button class="secondary" data-reset-cancel type="button">取消</button><button class="danger" data-reset-confirm type="button">${icon("reset")}确认删除</button></div></div>`;
  dialog.hidden = false;
  const accepted = await new Promise((resolve) => {
    dialog.onclick = (event) => {
      if (event.target === dialog || event.target.closest("[data-reset-cancel]")) resolve(false);
      if (event.target.closest("[data-reset-confirm]")) resolve(true);
    };
  });
  dialog.hidden = true;
  if (!accepted || !state.conversation) return;
  const id = state.conversation.id;
  els.resetConversationButton.disabled = true;
  await api(`/api/conversations/${id}/reset`, { method: "POST" });
  state.conversation = null;
  await Promise.all([loadConversations({ keepSelection: false, resetPage: true }), loadAlerts()]);
  showToast("会话已删除");
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

function renderAccountForm() {
  const form = els.accountForm;
  const fields = form.elements;
  fields.namedItem("personName").value = state.account.person?.name || "";
  fields.namedItem("personTitle").value = state.account.person?.title || "";
  fields.namedItem("channelName").value = `${state.account.provider === "miniapp" ? "智能名片" : "官网客服"} · ${state.account.name}`;
  fields.namedItem("bindingScope").value = agentBindingDisplayName(state.account.agentBinding);
  fields.namedItem("personality").value = state.account.person?.persona?.personality || "";
  fields.namedItem("speakingStyle").value = state.account.person?.persona?.speakingStyle || "";
  fields.namedItem("responsibilities").value = state.account.person?.persona?.responsibilities || "";
  const base = location.origin;
  els.inboundEndpoint.textContent = `POST ${base}/api/channels/${state.account.provider}/${state.account.id}/events`;
  els.outboxEndpoint.textContent = `GET ${base}/api/channels/${state.account.provider}/${state.account.id}/conversations/{conversationId}/outbox?after=0`;
}

function agentBindingDisplayName(binding) {
  if (!binding) return "尚未配置";
  const name = binding.name || binding.agentId || binding.id || "Agent";
  const suffix = ({
    "platform-default": "默认",
    person: "人物绑定",
    assistant: "助手绑定",
    workspace: "工作区",
    platform: "平台默认",
    "legacy-account": "兼容配置"
  })[binding.inheritedFrom];
  return suffix ? `${name}（${suffix}）` : name;
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
  const name = (state.machine.config?.nodes || []).find((item) => item.id === id)?.name || id || "未设置";
  if (name !== id) return name;
  return ({ new: "新会话", engaged: "持续沟通", completed: "已完成", closed: "已结束" })[id] || name;
}

function deliveryLabel(status) {
  return ({ pending: "发送中", queued: "已进入渠道队列", sent: "已发送", delivered: "已送达", read: "已读", failed: "发送失败" })[status] || status;
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
  document.querySelectorAll("[data-go-tab]").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.goTab)));
  els.accountList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-employee-id]");
    if (!card) return;
    const tab = event.target.closest("[data-account-tab]")?.dataset.accountTab || state.activeTab;
    selectEmployee(card.dataset.employeeId, tab).catch(handleError);
  });
  els.conversationChannelTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-channel-account-id]");
    if (button) selectEmployeeChannel(button.dataset.channelAccountId).catch(handleError);
  });
  els.businessDashboard.addEventListener("click", (event) => {
    const channelButton = event.target.closest("[data-dashboard-channel]");
    if (channelButton) {
      openDashboardChannel(channelButton.dataset.dashboardChannel).catch(handleError);
      return;
    }
    const alertButton = event.target.closest("[data-dashboard-alert-conversation]");
    if (alertButton) openDashboardConversation(alertButton.dataset.dashboardAlertAccount, Number(alertButton.dataset.dashboardAlertConversation)).catch(handleError);
  });
  els.refreshButton.addEventListener("click", () => loadAccountContext().then(() => showToast("数据已刷新")).catch(handleError));
  els.refreshConversations.addEventListener("click", () => loadConversations().catch(handleError));
  let searchTimer;
  els.conversationSearch.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadConversations({ keepSelection: false, resetPage: true }).catch(handleError), 250); });
  els.conversationDateFilter.addEventListener("change", () => loadConversations({ keepSelection: false, resetPage: true }).catch(handleError));
  els.conversationStateFilter.addEventListener("change", () => loadConversations({ keepSelection: false, resetPage: true }).catch(handleError));
  els.conversationTagFilterButton.addEventListener("click", (event) => {
    event.stopPropagation();
    els.conversationTagFilterMenu.hidden = !els.conversationTagFilterMenu.hidden;
    els.conversationTagFilterButton.setAttribute("aria-expanded", String(!els.conversationTagFilterMenu.hidden));
  });
  els.conversationTagFilterMenu.addEventListener("change", (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    [...els.conversationTagFilter.options].forEach((option) => { option.selected = option.value === checkbox.value ? checkbox.checked : option.selected; });
    renderConversationTagOptions();
    loadConversations({ keepSelection: false, resetPage: true }).catch(handleError);
  });
  els.conversationList.addEventListener("click", (event) => {
    const modeSwitch = event.target.closest("[data-conversation-mode]");
    if (modeSwitch) {
      const conversation = state.conversations.find((item) => item.id === Number(modeSwitch.dataset.conversationMode));
      if (conversation) setConversationMode(conversation).then((mode) => showToast(mode === "human" ? "已切换为人工接待" : "已交还 AI 接待")).catch(handleError);
      return;
    }
    const tagButton = event.target.closest("[data-conversation-tags]");
    if (tagButton) {
      openConversation(Number(tagButton.dataset.conversationTags)).then(addConversationTag).catch(handleError);
      return;
    }
    const card = event.target.closest("[data-conversation-id]");
    if (card) openConversation(Number(card.dataset.conversationId)).catch(handleError);
  });
  els.conversationList.addEventListener("keydown", (event) => {
    const card = event.target.closest("[data-conversation-id]");
    if (card && event.target === card && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      openConversation(Number(card.dataset.conversationId)).catch(handleError);
    }
  });
  els.conversationSummary.addEventListener("change", (event) => {
    const size = event.target.closest("[data-conversation-page-size]");
    if (!size) return;
    state.conversationPageSize = Number(size.value) || 20;
    state.conversationPage = 1;
    renderConversationList();
    renderConversationPagination();
  });
  els.conversationSummary.addEventListener("click", (event) => {
    const button = event.target.closest("[data-conversation-page]");
    if (!button || button.disabled) return;
    state.conversationPage = Number(button.dataset.conversationPage) || 1;
    renderConversationList();
    renderConversationPagination();
  });
  els.handoffSwitch.addEventListener("click", () => toggleHandoff().catch(handleError));
  els.handoffSwitch.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); toggleHandoff().catch(handleError); } });
  els.assetsButton.addEventListener("click", (event) => { event.stopPropagation(); els.assetsPanel.hidden = !els.assetsPanel.hidden; });
  els.resetConversationButton.addEventListener("click", () => resetConversation().catch(handleError));
  els.chatTags.addEventListener("click", (event) => { if (event.target.closest(".tag-add-button")) addConversationTag().catch(handleError); });
  els.manualReplyEmojiBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-manual-reply-emoji]");
    if (button) insertManualReplyEmoji(button.dataset.manualReplyEmoji || "");
  });
  els.manualReplyAttachmentButton.addEventListener("click", () => els.manualReplyUploadFile.click());
  els.manualReplyUploadFile.addEventListener("change", () => setManualReplyFiles(els.manualReplyUploadFile.files || []));
  els.manualReplyAttachmentList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-manual-file]");
    if (!button) return;
    state.manualReplyFiles.splice(Number(button.dataset.removeManualFile), 1);
    renderManualReplyFiles();
  });
  els.manualReplyComposer.addEventListener("submit", (event) => sendManual(event).catch(handleError));
  els.activationForm.addEventListener("submit", (event) => sendActivation(event).catch(handleError));
  els.alertButton.addEventListener("click", () => { els.alertPanel.hidden = !els.alertPanel.hidden; });
  els.closeAlerts.addEventListener("click", () => { els.alertPanel.hidden = true; });
  els.alertList.addEventListener("click", async (event) => {
    const resolve = event.target.closest("[data-alert-id]");
    if (resolve) { await api(`/api/alerts/${resolve.dataset.alertId}/resolve`, { method: "PUT" }); await loadAlerts(); return; }
    const alert = event.target.closest("[data-alert-conversation]");
    if (alert) { setTab("sessions"); await loadConversations(); await openConversation(Number(alert.dataset.alertConversation)); els.alertPanel.hidden = true; }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".tag-multi-select")) {
      els.conversationTagFilterMenu.hidden = true;
      els.conversationTagFilterButton.setAttribute("aria-expanded", "false");
    }
    if (!event.target.closest("#assetsPanel") && !event.target.closest("#assetsButton")) els.assetsPanel.hidden = true;
  });
}

function handleError(error) {
  console.error(error);
  showToast(error.message || String(error), true);
}

bootstrap().catch(handleError);
