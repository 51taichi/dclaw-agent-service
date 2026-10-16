const state = {
  workspaces: [], workspace: null, people: [], channels: [], deployments: [], channelTypes: [],
  person: null, channel: null, deployment: null, creatingWorkspace: false, creatingPerson: false,
  creatingChannel: false, creatingDeployment: false, bindings: { platform: null, workspace: null, person: null }
};

const els = Object.fromEntries([...document.querySelectorAll("[id]")].map((node) => [node.getAttribute("id"), node]));
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers }, body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `请求失败 (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

async function bootstrap() {
  bindEvents();
  const [workspaces, types] = await Promise.all([api("/api/admin/workspaces"), api("/api/admin/channel-types")]);
  state.workspaces = workspaces.items;
  state.channelTypes = types.items;
  const requested = new URLSearchParams(location.search).get("workspace");
  state.workspace = state.workspaces.find((item) => item.id === requested) || state.workspaces[0] || null;
  renderWorkspaceList();
  if (state.workspace) await loadWorkspaceContext();
  else startWorkspace();
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const requestedButton = document.querySelector(`[data-tab="${requestedTab}"]`);
  if (requestedButton) requestedButton.click();
}

async function loadWorkspaceContext() {
  if (!state.workspace) return;
  const id = encodeURIComponent(state.workspace.id);
  const [people, channels, deployments, platformBinding, workspaceBinding] = await Promise.all([
    api(`/api/admin/workspaces/${id}/people`),
    api(`/api/admin/workspaces/${id}/channels`),
    api(`/api/admin/workspaces/${id}/deployments`),
    api("/api/admin/agent-bindings/platform/default"),
    api(`/api/admin/agent-bindings/workspace/${id}`)
  ]);
  state.people = people.items;
  state.channels = channels.items;
  state.deployments = deployments.items;
  state.person = state.people.find((item) => item.id === state.person?.id) || state.people[0] || null;
  state.channel = state.channels.find((item) => item.id === state.channel?.id) || state.channels[0] || null;
  state.deployment = state.deployments.find((item) => item.id === state.deployment?.id && item.workspaceChannelId === state.channel?.id) || state.deployments.find((item) => item.workspaceChannelId === state.channel?.id) || null;
  state.bindings.platform = platformBinding.binding;
  state.bindings.workspace = workspaceBinding.binding;
  state.bindings.person = state.person ? (await api(`/api/admin/agent-bindings/person/${encodeURIComponent(state.person.id)}`)).binding : null;
  state.creatingWorkspace = false;
  state.creatingPerson = false;
  state.creatingChannel = false;
  state.creatingDeployment = false;
  renderAll();
}

function renderAll() {
  els.adminEmpty.hidden = true;
  els.workspaceShell.hidden = false;
  els.workspaceTitle.textContent = state.workspace.name;
  els.workspaceSlug.textContent = `工作区 / ${state.workspace.slug}`;
  els.workspaceStatus.textContent = state.workspace.enabled ? "运行中" : "已停用";
  els.workspaceStatus.className = `pill ${state.workspace.enabled ? "ok" : "off"}`;
  els.openConsole.href = `/console/?workspace=${encodeURIComponent(state.workspace.id)}`;
  els.openWorkspaceConsole.href = els.openConsole.href;
  renderWorkspaceList();
  renderWorkspaceForm();
  renderPeople();
  renderChannels();
  renderBindings();
}

function renderWorkspaceList() {
  els.workspaceList.innerHTML = state.workspaces.map((workspace) => `
    <article class="workspace-row ${workspace.id === state.workspace?.id && !state.creatingWorkspace ? "active" : ""}" style="--workspace-accent:${escapeHtml(workspace.accent)}">
      <button class="workspace-select" data-workspace-id="${escapeHtml(workspace.id)}">
        <svg><use href="#i-grid"/></svg>
        <span><strong>${escapeHtml(workspace.name)}</strong><small>${workspace.personCount} 人物 · ${workspace.channelCount} 渠道</small></span>
      </button>
      <label class="workspace-switch" title="${workspace.enabled ? "停用" : "启用"}${escapeHtml(workspace.name)}">
        <input type="checkbox" data-workspace-toggle="${escapeHtml(workspace.id)}" ${workspace.enabled ? "checked" : ""}/><span></span>
      </label>
    </article>`).join("") || '<div class="list-empty">暂无工作区</div>';
}

function renderWorkspaceForm() {
  const form = els.workspaceForm;
  const workspace = state.creatingWorkspace ? null : state.workspace;
  form.reset();
  setField(form, "id", workspace?.id || "");
  form.elements.id.disabled = Boolean(workspace);
  setField(form, "slug", workspace?.slug || "");
  setField(form, "name", workspace?.name || "");
  setField(form, "accent", workspace?.accent || "#2a30d8");
  setField(form, "logoUrl", workspace?.logoUrl || "");
  setField(form, "industry", workspace?.companyContext?.industry || "");
  setField(form, "description", workspace?.companyContext?.description || "");
  els.workspaceFormHint.textContent = workspace ? `${workspace.enabled ? "已启用" : "已停用"} · ${workspace.personCount} 个智能员工 · ${workspace.channelCount} 个渠道` : "新工作区创建后默认启用";
  els.openWorkspaceConsole.hidden = !workspace;
  if (workspace) els.openWorkspaceConsole.href = `/console/?workspace=${encodeURIComponent(workspace.id)}`;
}

function renderPeople() {
  els.personList.innerHTML = state.people.map((person) => `
    <button class="entity-row ${person.id === state.person?.id && !state.creatingPerson ? "active" : ""}" data-person-id="${escapeHtml(person.id)}">
      ${person.avatarUrl ? `<img src="${escapeHtml(person.avatarUrl)}" alt="" />` : `<span class="avatar-fallback">${escapeHtml(person.name.slice(0, 1))}</span>`}
      <span><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.title || "未设置职务")} · ${person.deploymentCount} 个部署</small></span>
      <i class="status-dot ${person.enabled ? "on" : ""}"></i>
    </button>`).join("") || '<div class="list-empty">还没有智能员工</div>';
  renderPersonForm();
  renderPersonOptions();
}

function renderPersonForm() {
  const form = els.personForm;
  const person = state.creatingPerson ? null : state.person;
  form.reset();
  setField(form, "id", person?.id || "");
  form.elements.id.disabled = Boolean(person);
  setField(form, "name", person?.name || "");
  setField(form, "title", person?.title || "");
  setField(form, "avatarUrl", person?.avatarUrl || "");
  setField(form, "personality", person?.persona?.personality || "");
  setField(form, "speakingStyle", person?.persona?.speakingStyle || "");
  setField(form, "responsibilities", person?.persona?.responsibilities || "");
  setField(form, "systemPrompt", person?.persona?.systemPrompt || "");
  form.elements.enabled.checked = person?.enabled !== false;
}

function renderChannels() {
  els.channelList.innerHTML = state.channels.map((channel) => `
    <button class="entity-row channel-row ${channel.id === state.channel?.id && !state.creatingChannel ? "active" : ""}" data-channel-id="${escapeHtml(channel.id)}">
      <span class="channel-glyph">${channel.provider === "miniapp" ? "名" : "网"}</span>
      <span><strong>${escapeHtml(channel.name)}</strong><small>${channel.provider === "miniapp" ? "智能体名片" : "官网客服"} · v${channel.publishedVersion}</small></span>
      <i class="status-dot ${channel.enabled ? "on" : ""}"></i>
    </button>`).join("") || '<div class="list-empty">还没有开通渠道</div>';
  renderChannelForm();
  renderDeployments();
}

function renderChannelForm() {
  const form = els.channelForm;
  const channel = state.creatingChannel ? null : state.channel;
  form.reset();
  form.elements.provider.innerHTML = state.channelTypes.map((item) => `<option value="${item.provider}">${escapeHtml(item.name)}</option>`).join("");
  setField(form, "id", channel?.id || "");
  form.elements.id.disabled = Boolean(channel);
  setField(form, "provider", channel?.provider || state.channelTypes[0]?.provider || "website");
  form.elements.provider.disabled = Boolean(channel);
  setField(form, "name", channel?.name || "");
  form.elements.enabled.checked = channel?.enabled !== false;
  form.elements.webhookSecret.placeholder = channel?.webhookSecretConfigured ? "已配置；留空保持不变" : "可选；用于校验渠道入站消息";
  renderDynamicFields(els.channelConfigFields, currentChannelType()?.channelFields || [], channel?.config || {});
  els.publishChannel.disabled = !channel;
  els.newDeployment.disabled = !channel || !state.people.length;
}

function renderDeployments() {
  const items = state.deployments.filter((item) => item.workspaceChannelId === state.channel?.id);
  els.deploymentList.innerHTML = items.map((deployment) => `
    <article class="deployment-row ${deployment.id === state.deployment?.id ? "active" : ""}">
      <button data-deployment-id="${escapeHtml(deployment.id)}"><span><strong>${escapeHtml(deployment.personName)}</strong><small>${escapeHtml(deployment.publicSlug)} · v${deployment.publishedVersion}</small></span></button>
      <button class="secondary preview-button" data-preview-id="${escapeHtml(deployment.id)}"><svg><use href="#i-eye"/></svg>预览</button>
    </article>`).join("") || '<div class="list-empty">该渠道还没有部署人物</div>';
  renderDeploymentForm();
  renderPreview();
}

function renderDeploymentForm() {
  const form = els.deploymentForm;
  const deployment = state.creatingDeployment ? null : state.deployment;
  form.hidden = !state.creatingDeployment && !deployment;
  if (form.hidden) return;
  form.reset();
  renderPersonOptions();
  setField(form, "id", deployment?.id || "");
  form.elements.id.disabled = Boolean(deployment);
  setField(form, "personId", deployment?.personId || state.people[0]?.id || "");
  form.elements.personId.disabled = Boolean(deployment);
  setField(form, "publicSlug", deployment?.publicSlug || "");
  setField(form, "sortOrder", deployment?.sortOrder ?? 0);
  form.elements.enabled.checked = deployment?.enabled !== false;
  renderDynamicFields(els.deploymentConfigFields, currentChannelType()?.deploymentFields || [], deployment?.config || {});
}

function renderPersonOptions() {
  const options = state.people.map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)} · ${escapeHtml(person.title || "未设置职务")}</option>`).join("");
  els.deploymentForm.elements.personId.innerHTML = options;
  els.bindingPerson.innerHTML = options;
  if (state.person) els.bindingPerson.value = state.person.id;
}

function renderDynamicFields(container, fields, values) {
  container.innerHTML = fields.map((field) => {
    const value = values[field.key] ?? field.default;
    if (field.type === "boolean") return `<label class="config-toggle"><input data-config-key="${field.key}" data-config-type="boolean" type="checkbox" ${value ? "checked" : ""}/><span>${escapeHtml(field.label)}</span></label>`;
    if (field.type === "select") return `<label><span>${escapeHtml(field.label)}</span><select data-config-key="${field.key}" data-config-type="select">${field.options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`;
    const multiline = ["textarea", "list", "resources"].includes(field.type);
    const shown = field.type === "list" ? (Array.isArray(value) ? value.join("\n") : "") : field.type === "resources" ? (Array.isArray(value) ? value.map((item) => `${item.name || "资料"}|${item.url || ""}`).join("\n") : "") : value || "";
    return `<label class="${multiline ? "wide" : ""}"><span>${escapeHtml(field.label)}</span>${multiline ? `<textarea rows="3" data-config-key="${field.key}" data-config-type="${field.type}" placeholder="${field.type === "resources" ? "每行：资料名称|URL" : field.type === "list" ? "每行一个" : ""}">${escapeHtml(shown)}</textarea>` : `<input data-config-key="${field.key}" data-config-type="${field.type}" type="${field.type === "color" ? "color" : field.type === "url" ? "url" : "text"}" value="${escapeHtml(shown)}"/>`}</label>`;
  }).join("");
}

function readDynamicFields(container) {
  return Object.fromEntries([...container.querySelectorAll("[data-config-key]")].map((field) => {
    let value = field.type === "checkbox" ? field.checked : field.value.trim();
    if (field.dataset.configType === "list") value = value.split("\n").map((item) => item.trim()).filter(Boolean);
    if (field.dataset.configType === "resources") value = value.split("\n").map((item) => { const [name, ...url] = item.split("|"); return { name: name.trim(), url: url.join("|").trim() }; }).filter((item) => item.name && item.url);
    return [field.dataset.configKey, value];
  }));
}

function renderPreview() {
  if (!state.deployment) {
    els.channelPreview.removeAttribute("src");
    els.previewMode.textContent = "选择一个人物部署";
    els.openPreview.disabled = true;
    return;
  }
  const url = `/channel-preview/?deployment=${encodeURIComponent(state.deployment.id)}&t=${Date.now()}`;
  els.channelPreview.src = url;
  els.previewMode.textContent = `草稿 · ${state.deployment.personName}`;
  els.openPreview.disabled = false;
  els.openPreview.dataset.url = url;
}

function renderBindings() {
  els.platformBindingForm.innerHTML = bindingMarkup("平台级", "全平台默认 Agent", state.bindings.platform, true);
  els.workspaceBindingForm.innerHTML = bindingMarkup("工作区级", `${state.workspace.name} 覆盖`, state.bindings.workspace, false);
  renderPersonOptions();
  els.personBindingForm.innerHTML = bindingFieldsMarkup(state.bindings.person, false);
}

function bindingMarkup(level, title, binding, platform) {
  return `<div class="binding-card-head"><div><small>${level}</small><h3>${escapeHtml(title)}</h3></div><span class="inherit-pill">${binding?.enabled ? "已配置" : platform ? "未配置" : "继承上级"}</span></div>${bindingFieldsMarkup(binding, platform)}`;
}

function bindingFieldsMarkup(binding, platform) {
  return `<label class="toggle-line"><input name="enabled" type="checkbox" ${binding?.enabled || (platform && !binding) ? "checked" : ""}/><span>${platform ? "启用平台默认" : "启用本级覆盖"}</span></label>
    <label><span>配置名称</span><input name="name" value="${escapeHtml(binding?.name || "")}" placeholder="例如 主账号 / 高并发账号"/></label>
    <label><span>OpenAPI URL</span><input name="agentApiUrl" type="url" value="${escapeHtml(binding?.agentApiUrl || "")}" placeholder="https://.../openapi/chat"/></label>
    <label><span>Agent ID</span><input name="agentId" value="${escapeHtml(binding?.agentId || "")}"/></label>
    <label><span>API Key</span><input name="agentApiKey" type="password" autocomplete="new-password" placeholder="${binding?.agentApiKeyConfigured ? "已配置；留空保持不变" : "请输入 API Key"}"/></label>
    <label><span>并发上限</span><input name="concurrencyLimit" type="number" min="0" value="${Number(binding?.concurrencyLimit || 0)}"/><small>0 表示由 Agent 服务端控制</small></label>
    <label><span>计费标识</span><input name="billingLabel" value="${escapeHtml(binding?.billingLabel || "")}" placeholder="用于账单归集"/></label>
    <button class="primary" type="submit"><svg><use href="#i-save"/></svg>保存 Agent 配置</button>`;
}

function currentChannelType() {
  const provider = state.creatingChannel ? els.channelForm.elements.provider.value : state.channel?.provider || els.channelForm.elements.provider.value;
  return state.channelTypes.find((item) => item.provider === provider);
}

function startWorkspace() {
  state.creatingWorkspace = true;
  state.workspace = null;
  els.adminEmpty.hidden = true;
  els.workspaceShell.hidden = false;
  els.workspaceTitle.textContent = "新建工作区";
  els.workspaceSlug.textContent = "平台租户";
  els.workspaceStatus.textContent = "待创建";
  els.openConsole.href = "/console/";
  activateTab("workspace");
  renderWorkspaceList();
  renderWorkspaceForm();
}

async function saveWorkspace(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = { id: form.elements.id.value, slug: form.elements.slug.value, name: form.elements.name.value, accent: form.elements.accent.value, logoUrl: form.elements.logoUrl.value, enabled: state.creatingWorkspace ? true : state.workspace.enabled, companyContext: { industry: form.elements.industry.value, description: form.elements.description.value } };
  if (state.creatingWorkspace) {
    state.workspace = await api("/api/admin/workspaces", { method: "POST", body });
  } else state.workspace = await api(`/api/admin/workspaces/${encodeURIComponent(state.workspace.id)}`, { method: "PUT", body });
  state.workspaces = (await api("/api/admin/workspaces")).items;
  await loadWorkspaceContext();
  toast("工作区已保存");
}

async function savePerson(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = { id: form.elements.id.value, name: form.elements.name.value, title: form.elements.title.value, avatarUrl: form.elements.avatarUrl.value, enabled: form.elements.enabled.checked, persona: { personality: form.elements.personality.value, speakingStyle: form.elements.speakingStyle.value, responsibilities: form.elements.responsibilities.value, systemPrompt: form.elements.systemPrompt.value } };
  if (state.creatingPerson) state.person = await api(`/api/admin/workspaces/${encodeURIComponent(state.workspace.id)}/people`, { method: "POST", body });
  else state.person = await api(`/api/admin/people/${encodeURIComponent(state.person.id)}`, { method: "PUT", body });
  await loadWorkspaceContext();
  toast("智能员工已保存");
}

async function saveChannel(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = { id: form.elements.id.value, provider: form.elements.provider.value, name: form.elements.name.value, enabled: form.elements.enabled.checked, config: readDynamicFields(els.channelConfigFields) };
  if (form.elements.webhookSecret.value) body.webhookSecret = form.elements.webhookSecret.value;
  if (state.creatingChannel) state.channel = await api(`/api/admin/workspaces/${encodeURIComponent(state.workspace.id)}/channels`, { method: "POST", body });
  else state.channel = await api(`/api/admin/channels/${encodeURIComponent(state.channel.id)}`, { method: "PUT", body });
  await loadWorkspaceContext();
  toast("渠道配置已保存");
}

async function saveDeployment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = { id: form.elements.id.value, personId: form.elements.personId.value, workspaceChannelId: state.channel.id, publicSlug: form.elements.publicSlug.value, sortOrder: Number(form.elements.sortOrder.value), enabled: form.elements.enabled.checked, config: readDynamicFields(els.deploymentConfigFields) };
  if (state.creatingDeployment) state.deployment = await api(`/api/admin/workspaces/${encodeURIComponent(state.workspace.id)}/deployments`, { method: "POST", body });
  else state.deployment = await api(`/api/admin/deployments/${encodeURIComponent(state.deployment.id)}`, { method: "PUT", body });
  await loadWorkspaceContext();
  toast("人物渠道部署已保存");
}

async function saveBinding(event, scopeType, getScopeId) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = { enabled: form.elements.enabled.checked, name: form.elements.name.value, agentApiUrl: form.elements.agentApiUrl.value, agentId: form.elements.agentId.value, concurrencyLimit: Number(form.elements.concurrencyLimit.value), billingLabel: form.elements.billingLabel.value };
  if (form.elements.agentApiKey.value) body.agentApiKey = form.elements.agentApiKey.value;
  const result = await api(`/api/admin/agent-bindings/${scopeType}/${encodeURIComponent(getScopeId())}`, { method: "PUT", body });
  state.bindings[scopeType] = result.binding;
  renderBindings();
  toast("Agent API 配置已保存");
}

async function toggleWorkspace(id, enabled) {
  const current = state.workspaces.find((item) => item.id === id);
  if (!current) return;
  await api(`/api/admin/workspaces/${encodeURIComponent(id)}`, { method: "PUT", body: { enabled } });
  state.workspaces = (await api("/api/admin/workspaces")).items;
  if (state.workspace?.id === id) state.workspace = state.workspaces.find((item) => item.id === id);
  if (state.creatingWorkspace) {
    renderWorkspaceList();
    renderWorkspaceForm();
  } else {
    renderAll();
  }
  toast(`${current.name}已${enabled ? "启用" : "停用"}`);
}

function activateTab(tab) {
  document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item.dataset.tab === tab));
  document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
  document.querySelector(".contextual-titlebar").hidden = tab === "workspace";
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
  els.workspaceList.addEventListener("click", (event) => { const button = event.target.closest("[data-workspace-id]"); if (!button) return; state.workspace = state.workspaces.find((item) => item.id === button.dataset.workspaceId); loadWorkspaceContext().catch(handleError); });
  els.workspaceList.addEventListener("change", (event) => { const toggle = event.target.closest("[data-workspace-toggle]"); if (!toggle) return; toggleWorkspace(toggle.dataset.workspaceToggle, toggle.checked).catch((error) => { toggle.checked = !toggle.checked; handleError(error); }); });
  els.personList.addEventListener("click", (event) => { const button = event.target.closest("[data-person-id]"); if (!button) return; state.person = state.people.find((item) => item.id === button.dataset.personId); state.creatingPerson = false; api(`/api/admin/agent-bindings/person/${encodeURIComponent(state.person.id)}`).then((data) => { state.bindings.person = data.binding; renderPeople(); renderBindings(); }).catch(handleError); });
  els.channelList.addEventListener("click", (event) => { const button = event.target.closest("[data-channel-id]"); if (!button) return; state.channel = state.channels.find((item) => item.id === button.dataset.channelId); state.deployment = state.deployments.find((item) => item.workspaceChannelId === state.channel.id) || null; state.creatingChannel = false; state.creatingDeployment = false; renderChannels(); });
  els.deploymentList.addEventListener("click", (event) => { const button = event.target.closest("[data-deployment-id], [data-preview-id]"); if (!button) return; const id = button.dataset.deploymentId || button.dataset.previewId; state.deployment = state.deployments.find((item) => item.id === id); state.creatingDeployment = false; renderDeployments(); });
  els.newWorkspace.addEventListener("click", startWorkspace);
  els.newPerson.addEventListener("click", () => { state.creatingPerson = true; state.person = null; renderPeople(); els.personForm.elements.id.focus(); });
  els.newChannel.addEventListener("click", () => { state.creatingChannel = true; state.channel = null; state.deployment = null; renderChannels(); els.channelForm.elements.id.focus(); });
  els.newDeployment.addEventListener("click", () => { state.creatingDeployment = true; state.deployment = null; renderDeployments(); els.deploymentForm.elements.id.focus(); });
  els.channelForm.elements.provider.addEventListener("change", () => renderDynamicFields(els.channelConfigFields, currentChannelType()?.channelFields || [], {}));
  els.workspaceForm.addEventListener("submit", (event) => saveWorkspace(event).catch(handleError));
  els.personForm.addEventListener("submit", (event) => savePerson(event).catch(handleError));
  els.channelForm.addEventListener("submit", (event) => saveChannel(event).catch(handleError));
  els.deploymentForm.addEventListener("submit", (event) => saveDeployment(event).catch(handleError));
  els.publishChannel.addEventListener("click", () => api(`/api/admin/channels/${encodeURIComponent(state.channel.id)}/publish`, { method: "POST" }).then(loadWorkspaceContext).then(() => toast("渠道草稿已发布")).catch(handleError));
  els.openPreview.addEventListener("click", () => { if (els.openPreview.dataset.url) window.open(els.openPreview.dataset.url, "_blank", "noopener"); });
  els.platformBindingForm.addEventListener("submit", (event) => saveBinding(event, "platform", () => "default").catch(handleError));
  els.workspaceBindingForm.addEventListener("submit", (event) => saveBinding(event, "workspace", () => state.workspace.id).catch(handleError));
  els.personBindingForm.addEventListener("submit", (event) => saveBinding(event, "person", () => els.bindingPerson.value).catch(handleError));
  els.bindingPerson.addEventListener("change", () => { state.person = state.people.find((item) => item.id === els.bindingPerson.value); api(`/api/admin/agent-bindings/person/${encodeURIComponent(state.person.id)}`).then((data) => { state.bindings.person = data.binding; renderBindings(); }).catch(handleError); });
}

function setField(form, name, value) { if (form.elements[name]) form.elements[name].value = value ?? ""; }
function toast(message) { els.toast.textContent = message; els.toast.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { els.toast.hidden = true; }, 2600); }
function handleError(error) { console.error(error); toast(error.message || String(error)); }

bootstrap().catch(handleError);
