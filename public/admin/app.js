const state = { accounts: [], adapters: [], selectedId: null, creating: false };
const els = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.getAttribute("id"), element]));

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers }, body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `请求失败 (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

async function load() {
  const [accounts, adapters] = await Promise.all([api("/api/accounts"), api("/api/adapters")]);
  state.accounts = accounts.items;
  state.adapters = adapters.items;
  if (!state.selectedId && state.accounts.length) state.selectedId = state.accounts[0].id;
  renderList();
  renderProviderOptions();
  renderForm();
  renderAdapters();
}

function renderList() {
  els.accountList.innerHTML = state.accounts.map((account) => `<article class="admin-workspace-card ${account.id === state.selectedId ? "active" : ""}"><button class="admin-workspace-select" data-account-id="${escapeHtml(account.id)}"><span class="channel-color" style="background:${escapeHtml(account.accent)}"></span><span><strong>${escapeHtml(account.name)}</strong><small>${escapeHtml(account.provider)} · ${escapeHtml(account.id)}</small></span></button><span class="pill ${account.enabled ? "ok" : "off"}">${account.enabled ? "启用" : "停用"}</span></article>`).join("") || `<div class="admin-empty-state">暂无渠道账号</div>`;
}

function renderProviderOptions() {
  els.accountForm.elements.namedItem("provider").innerHTML = state.adapters.map((adapter) => `<option value="${escapeHtml(adapter.provider)}">${escapeHtml(adapter.provider)}</option>`).join("");
}

function renderForm() {
  const form = els.accountForm;
  const fields = form.elements;
  const account = state.accounts.find((item) => item.id === state.selectedId);
  if (state.creating || !account) {
    form.reset();
    fields.namedItem("id").disabled = false;
    fields.namedItem("provider").disabled = false;
    fields.namedItem("enabled").checked = true;
    els.endpointCard.hidden = true;
    return;
  }
  fields.namedItem("id").value = account.id;
  fields.namedItem("id").disabled = true;
  fields.namedItem("provider").value = account.provider;
  fields.namedItem("provider").disabled = true;
  fields.namedItem("name").value = account.name;
  fields.namedItem("accent").value = account.accent;
  fields.namedItem("agentApiUrl").value = account.agentApiUrl;
  fields.namedItem("agentId").value = account.agentId;
  fields.namedItem("agentApiKey").value = "";
  fields.namedItem("agentApiKey").placeholder = account.agentApiKeyConfigured ? "已配置；留空保持不变" : "请输入 API Key";
  fields.namedItem("webhookSecret").value = "";
  fields.namedItem("webhookSecret").placeholder = account.webhookSecretConfigured ? "已配置；留空保持不变" : "可选";
  fields.namedItem("enabled").checked = account.enabled;
  renderEndpoints(account);
}

function renderEndpoints(account) {
  els.endpointCard.hidden = false;
  const base = location.origin;
  els.inboundEndpoint.textContent = `POST ${base}/api/channels/${account.provider}/${account.id}/events`;
  els.outboxEndpoint.textContent = `GET ${base}/api/channels/${account.provider}/${account.id}/conversations/{id}/outbox?after=0`;
  els.receiptEndpoint.textContent = `POST ${base}/api/channels/${account.provider}/${account.id}/receipts`;
}

function renderAdapters() {
  els.adapterGrid.innerHTML = state.adapters.map((adapter) => `<article class="adapter-card"><h2>${escapeHtml(adapter.provider)}</h2><div class="capability-list">${Object.entries(adapter.capabilities).map(([key, enabled]) => `<span class="capability ${enabled ? "" : "off"}">${enabled ? "支持" : "不支持"} ${escapeHtml(key)}</span>`).join("")}</div></article>`).join("");
}

async function saveAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = form.elements;
  const body = {
    id: fields.namedItem("id").value,
    provider: fields.namedItem("provider").value,
    name: fields.namedItem("name").value,
    accent: fields.namedItem("accent").value,
    agentApiUrl: fields.namedItem("agentApiUrl").value,
    agentId: fields.namedItem("agentId").value,
    enabled: fields.namedItem("enabled").checked
  };
  if (fields.namedItem("agentApiKey").value) body.agentApiKey = fields.namedItem("agentApiKey").value;
  if (fields.namedItem("webhookSecret").value) body.webhookSecret = fields.namedItem("webhookSecret").value;
  if (state.creating) {
    const created = await api("/api/accounts", { method: "POST", body });
    state.selectedId = created.id;
    state.creating = false;
  } else {
    await api(`/api/accounts/${encodeURIComponent(state.selectedId)}`, { method: "PUT", body });
  }
  await load();
  toast("渠道账号已保存");
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { els.toast.hidden = true; }, 2500);
}

function handleError(error) {
  console.error(error);
  toast(error.message || String(error));
}

document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === button.dataset.tab));
}));
els.accountList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-account-id]");
  if (!button) return;
  state.selectedId = button.dataset.accountId;
  state.creating = false;
  renderList();
  renderForm();
});
els.newAccountButton.addEventListener("click", () => { state.creating = true; state.selectedId = null; renderList(); renderForm(); els.accountForm.elements.namedItem("id").focus(); });
els.accountForm.addEventListener("submit", (event) => saveAccount(event).catch(handleError));
els.refreshAdapters.addEventListener("click", () => load().then(() => toast("能力信息已刷新")).catch(handleError));
load().catch(handleError);
