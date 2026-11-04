import { initUnifiedSelects, syncUnifiedSelect } from "../components/select.js";

const state = {
  session: null,
  workspaces: [], workspace: null, people: [], channels: [], deployments: [], channelTypes: [],
  miniappConfig: null,
  person: null, creatingWorkspace: false, creatingPerson: false,
  agentConfigs: [], agentDefaults: { defaultAgentConfigId: "" },
  agentConfig: null, creatingAgentConfig: false, configProvider: "website", focusedConfigField: "", miniappMapFace: "back"
};
let previewRevision = 0;
let mapSkinToneRevision = 0;

const els = Object.fromEntries([...document.querySelectorAll("[id]")].map((node) => [node.getAttribute("id"), node]));
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const localizedErrorMessage = (value, fallback = "操作失败，请稍后重试") => {
  const message = String(value || "").trim();
  return /[\u3400-\u9fff]/.test(message) ? message : fallback;
};
const safeMapColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;
const mapSkinPaletteCache = new Map();

function detectMapSkinPalette(imageUrl) {
  if (!imageUrl) return Promise.resolve({ tone: "dark", brand: "" });
  if (mapSkinPaletteCache.has(imageUrl)) return mapSkinPaletteCache.get(imageUrl);
  const detection = new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    try {
      if (new URL(imageUrl, location.href).origin !== location.origin) image.crossOrigin = "anonymous";
    } catch {}
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 40;
        canvas.height = 40;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let luminance = 0;
        let weight = 0;
        let colorWeight = 0;
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let y = 23; y < 38; y += 1) {
          for (let x = 4; x < 36; x += 1) {
            const index = (y * canvas.width + x) * 4;
            const alpha = pixels[index + 3] / 255;
            if (alpha < 0.2) continue;
            const pixelRed = pixels[index];
            const pixelGreen = pixels[index + 1];
            const pixelBlue = pixels[index + 2];
            const maximum = Math.max(pixelRed, pixelGreen, pixelBlue);
            const saturation = maximum ? (maximum - Math.min(pixelRed, pixelGreen, pixelBlue)) / maximum : 0;
            const chromaWeight = alpha * (0.02 + saturation * saturation * saturation * 3);
            luminance += ((pixelRed * 0.2126 + pixelGreen * 0.7152 + pixelBlue * 0.0722) / 255) * alpha;
            weight += alpha;
            red += pixelRed * chromaWeight;
            green += pixelGreen * chromaWeight;
            blue += pixelBlue * chromaWeight;
            colorWeight += chromaWeight;
          }
        }
        const brand = colorWeight
          ? `#${[red, green, blue].map((value) => Math.round(value / colorWeight).toString(16).padStart(2, "0")).join("")}`
          : "";
        resolve({ tone: weight && luminance / weight >= 0.5 ? "light" : "dark", brand });
      } catch {
        resolve({ tone: "dark", brand: "" });
      }
    };
    image.onerror = () => resolve({ tone: "dark", brand: "" });
    image.src = imageUrl;
  });
  mapSkinPaletteCache.set(imageUrl, detection);
  return detection;
}

function detectMapSkinTone(imageUrl) {
  return detectMapSkinPalette(imageUrl).then((palette) => palette.tone);
}

function syncMapSkinTone(imageUrl, autoColor = true) {
  const revision = ++mapSkinToneRevision;
  if (!imageUrl) {
    delete els.websiteRosterMap.dataset.skinTone;
    return;
  }
  els.websiteRosterMap.dataset.skinTone = "dark";
  detectMapSkinPalette(imageUrl).then((palette) => {
    if (revision !== mapSkinToneRevision) return;
    els.websiteRosterMap.dataset.skinTone = palette.tone;
    if (autoColor && palette.brand) els.websiteRosterMap.style.setProperty("--map-brand-color", palette.brand);
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers }, body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(localizedErrorMessage(data.error, `请求失败（HTTP ${response.status}）`));
  }
  return response.status === 204 ? null : response.json();
}

const ADMIN_MEDIA_RULES = {
  video: { types: ["video/mp4", "video/webm"], maxBytes: 30 * 1024 * 1024, accept: "video/mp4,video/webm,.mp4,.webm", label: "视频" },
  image: { types: ["image/png", "image/jpeg", "image/webp"], maxBytes: 10 * 1024 * 1024, accept: "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp", label: "图片" }
};

async function uploadAdminAsset(file, kind) {
  const rule = ADMIN_MEDIA_RULES[kind];
  if (!file || !rule?.types.includes(file.type)) throw new Error(kind === "video" ? "请选择 MP4 或 WebM 视频" : "请选择 PNG、JPEG 或 WebP 图片");
  if (file.size > rule.maxBytes) throw new Error(`${rule.label}不能超过 ${rule.maxBytes / 1024 / 1024}MB`);
  const response = await fetch("/api/admin/media", {
    method: "POST",
    headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
    body: file
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(localizedErrorMessage(data.error, `上传失败（HTTP ${response.status}）`));
  return data.asset;
}

async function bootstrap() {
  initUnifiedSelects();
  bindEvents();
  const requestedWorkspaceId = new URLSearchParams(location.search).get("workspace") || "";
  const session = await api(`/api/admin/auth/session${requestedWorkspaceId ? `?workspace=${encodeURIComponent(requestedWorkspaceId)}` : ""}`);
  if (!session.authenticated) {
    showLogin(session);
    return;
  }
  state.session = session;
  applySession();
  await loadApplication();
}

async function loadApplication() {
  const [workspaces, types, agents] = await Promise.all([api("/api/admin/workspaces"), api("/api/admin/channel-types"), api("/api/admin/agents")]);
  state.workspaces = workspaces.items;
  state.channelTypes = types.items;
  state.agentConfigs = agents.items;
  state.agentDefaults = agents.defaults;
  state.agentConfig = state.agentConfigs[0] || null;
  const requested = new URLSearchParams(location.search).get("workspace");
  state.workspace = state.workspaces.find((item) => item.id === requested) || state.workspaces[0] || null;
  renderWorkspaceList();
  if (state.workspace) await loadWorkspaceContext();
  else startWorkspace();
  const requestedTabValue = new URLSearchParams(location.search).get("tab");
  const requestedTab = requestedTabValue === "channels" ? "config" : requestedTabValue;
  const requestedButton = document.querySelector(`[data-tab="${state.session?.role === "workspace" && requestedTab === "agent" ? "workspace" : requestedTab}"]`);
  if (requestedButton) requestedButton.click();
}

function showLogin(session) {
  state.session = session;
  els.adminMain.hidden = true;
  els.loginShell.hidden = false;
  const workspace = session.targetWorkspace;
  els.loginTitle.textContent = workspace ? `${workspace.name}工作区` : "平台管理员登录";
  els.loginDescription.textContent = workspace ? `请输入 ${workspace.id} 的工作区密码` : "登录后可查看和管理全部工作区";
  els.loginForm.elements.password.focus();
}

function applySession() {
  els.loginShell.hidden = true;
  els.adminMain.hidden = false;
  const workspaceRole = state.session?.role === "workspace";
  els.roleBadge.hidden = false;
  els.roleBadge.textContent = workspaceRole ? "工作区管理员" : "平台管理员";
  els.logoutButton.hidden = !state.session?.authRequired;
  els.newWorkspace.hidden = workspaceRole;
  els.agentTab.hidden = workspaceRole;
  els.workspacePasswordField.hidden = workspaceRole;
  document.querySelector(".workspace-list-pane").hidden = workspaceRole;
  document.querySelector(".workspace-management-layout").classList.toggle("single-workspace", workspaceRole);
}

async function login(event) {
  event.preventDefault();
  els.loginError.hidden = true;
  const submit = els.loginForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await api("/api/admin/auth/login", { method: "POST", body: {
      workspaceId: new URLSearchParams(location.search).get("workspace") || "",
      password: els.loginForm.elements.password.value
    } });
    const returnTo = new URLSearchParams(location.search).get("returnTo") || "";
    if (returnTo.startsWith("/console/") && !returnTo.startsWith("//")) location.replace(returnTo);
    else location.reload();
  } catch (error) {
    els.loginError.textContent = localizedErrorMessage(error?.message || error);
    els.loginError.hidden = false;
    els.loginForm.elements.password.select();
  } finally {
    submit.disabled = false;
  }
}

async function logout() {
  await api("/api/admin/auth/logout", { method: "POST" });
  location.reload();
}

async function loadWorkspaceContext() {
  if (!state.workspace) return;
  const id = encodeURIComponent(state.workspace.id);
  const [people, channels, deployments, miniapp] = await Promise.all([
    api(`/api/admin/workspaces/${id}/people`),
    api(`/api/admin/workspaces/${id}/channels`),
    api(`/api/admin/workspaces/${id}/deployments`),
    api(`/api/admin/workspaces/${id}/miniapp`)
  ]);
  state.people = people.items;
  state.channels = channels.items;
  state.deployments = deployments.items;
  state.miniappConfig = miniapp.config;
  state.person = state.people.find((item) => item.id === state.person?.id) || state.people[0] || null;
  state.creatingWorkspace = false;
  state.creatingPerson = false;
  renderAll();
}

function renderAll() {
  els.adminEmpty.hidden = true;
  els.workspaceShell.hidden = false;
  els.workspaceTitle.textContent = `工作区 / ${state.workspace.name}`;
  els.workspaceStatus.textContent = state.workspace.enabled ? "运行中" : "已停用";
  els.workspaceStatus.className = `pill ${state.workspace.enabled ? "ok" : "off"}`;
  els.openWorkspaceConsole.href = `/console/?workspace=${encodeURIComponent(state.workspace.id)}`;
  renderWorkspaceList();
  renderWorkspaceForm();
  renderPeople();
  renderConfiguration();
  renderAgentLibrary();
}

function renderWorkspaceList() {
  els.workspaceList.innerHTML = state.workspaces.map((workspace) => `
    <article class="workspace-row ${workspace.id === state.workspace?.id && !state.creatingWorkspace ? "active" : ""}" style="--workspace-accent:${escapeHtml(workspace.accent)}">
      <button class="workspace-select" data-workspace-id="${escapeHtml(workspace.id)}">
        <svg><use href="#i-grid"/></svg>
        <span><strong>${escapeHtml(workspace.name)}</strong><small>${workspace.personCount} 人物 · ${workspace.channelCount} 端口</small></span>
      </button>
      <label class="row-switch" title="${workspace.enabled ? "停用" : "启用"}${escapeHtml(workspace.name)}">
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
  setField(form, "adminPassword", "");
  els.workspacePasswordHint.textContent = workspace?.passwordConfigured ? "已配置，留空表示不修改" : "未配置，至少输入 8 位";
  els.workspaceLogoField.innerHTML = fixedMediaFieldMarkup({ name: "logoUrl", label: "公司 Logo", kind: "image", value: workspace?.logoUrl || "" });
  setField(form, "industry", workspace?.companyContext?.industry || "");
  setField(form, "description", workspace?.companyContext?.description || "");
  els.openWorkspaceConsole.hidden = !workspace;
  if (workspace) els.openWorkspaceConsole.href = `/console/?workspace=${encodeURIComponent(workspace.id)}`;
}

function renderPeople() {
  els.personList.innerHTML = state.people.map((person) => `
    <article class="entity-row ${person.id === state.person?.id && !state.creatingPerson ? "active" : ""}">
      <button class="entity-select" data-person-id="${escapeHtml(person.id)}">
        ${person.avatarUrl ? `<img src="${escapeHtml(person.avatarUrl)}" alt="" />` : `<span class="avatar-fallback">${escapeHtml(person.name.slice(0, 1))}</span>`}
        <span><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.title || "未设置职务")} · ${person.deploymentCount} 个端口</small></span>
      </button>
      <label class="row-switch" title="${person.enabled ? "停用" : "启用"}${escapeHtml(person.name)}">
        <input type="checkbox" data-person-toggle="${escapeHtml(person.id)}" ${person.enabled ? "checked" : ""}/><span></span>
      </label>
    </article>`).join("") || '<div class="list-empty">还没有智能员工</div>';
  renderPersonForm();
  renderPersonChannels();
}

function renderPersonForm() {
  const form = els.personForm;
  const person = state.creatingPerson ? null : state.person;
  form.reset();
  setField(form, "id", person?.id || "");
  form.elements.id.disabled = Boolean(person);
  setField(form, "name", person?.name || "");
  setField(form, "title", person?.title || "");
  els.personAvatarField.innerHTML = fixedMediaFieldMarkup({ name: "avatarUrl", label: "人物头像", kind: "image", value: person?.avatarUrl || "" });
  setField(form, "personality", person?.persona?.personality || "");
  setField(form, "speakingStyle", person?.persona?.speakingStyle || "");
  setField(form, "responsibilities", person?.persona?.responsibilities || "");
  setField(form, "systemPrompt", person?.persona?.systemPrompt || "");
  const agentOverrideEnabled = Boolean(person?.agentConfigId);
  form.elements.agentOverrideEnabled.checked = agentOverrideEnabled;
  delete form.elements.agentConfigId.dataset.overrideValue;
  renderAgentBindingSelect(form, "agentConfigId", agentOverrideEnabled, person?.agentConfigId || "");
  renderDynamicFields(els.personProfileFields, personProfileFields(), person?.profile || {});
}

function personProfileFields() {
  return state.channelTypes.find((item) => Array.isArray(item.personFields))?.personFields || [];
}

function renderPersonChannels() {
  if (!state.person || state.creatingPerson) {
    els.personChannelList.innerHTML = '<div class="list-empty compact-empty">请先保存人物</div>';
    return;
  }
  els.personChannelList.innerHTML = state.channels.map((channel) => {
    const deployment = state.deployments.find((item) => item.personId === state.person.id && item.workspaceChannelId === channel.id);
    return `<label class="person-channel-row">
      <span class="channel-glyph">${channel.provider === "miniapp" ? "名" : "网"}</span>
      <span><strong>${escapeHtml(channel.name)}</strong><small>${channel.provider === "miniapp" ? "智能体名片" : "官网客服"}</small></span>
      <span class="inherit-pill ${deployment?.enabled ? "active" : ""}">${deployment?.enabled ? "已开通" : "未开通"}</span>
      <span class="row-switch"><input type="checkbox" data-person-channel-toggle="${escapeHtml(channel.id)}" ${deployment?.enabled ? "checked" : ""}/><span></span></span>
    </label>`;
  }).join("") || '<div class="list-empty compact-empty">还没有配置端口</div>';
}

const WEBSITE_BACKGROUND_KEYS = new Set(["homepageImageUrl"]);
const WEBSITE_CONFIG_KEYS = new Set(["panelSkinImageUrl", "employeeItemColorAuto", "employeeItemColor", "employeeActionLabel", "employeeActionColor", "employeeAvatarShape", "panelBorderColor", "panelShape", "allowedDomains"]);

function syncWebsiteColorControls() {
  const autoColor = els.websiteConfigFields.querySelector('[data-config-key="employeeItemColorAuto"]');
  const colorField = els.websiteConfigFields.querySelector('[data-config-key="employeeItemColor"]')?.closest("label");
  if (colorField) colorField.hidden = autoColor?.checked !== false;
}

function channelFor(provider) {
  return state.channels.find((item) => item.provider === provider) || null;
}

function channelTypeFor(provider) {
  return state.channelTypes.find((item) => item.provider === provider) || null;
}

function configFieldsFor(provider) {
  const fields = channelTypeFor(provider)?.channelFields || [];
  return provider === "website" ? fields.filter((field) => WEBSITE_CONFIG_KEYS.has(field.key) || WEBSITE_BACKGROUND_KEYS.has(field.key)) : fields;
}

function renderConfiguration() {
  renderProviderForm("website");
  renderProviderForm("miniapp");
  activateConfigProvider(state.configProvider);
}

function activateConfigProvider(provider) {
  state.configProvider = provider;
  document.querySelectorAll("[data-config-provider]").forEach((button) => button.classList.toggle("active", button.dataset.configProvider === state.configProvider));
  document.querySelectorAll("[data-provider-form]").forEach((form) => { form.hidden = form.dataset.providerForm !== state.configProvider; });
  document.querySelectorAll("[data-field-map]").forEach((map) => { map.hidden = map.dataset.fieldMap !== state.configProvider; });
  els.fieldMapPane.classList.toggle("is-miniapp", state.configProvider === "miniapp");
  els.configEditorLayout.classList.toggle("is-miniapp", state.configProvider === "miniapp");
  renderFieldMap(state.configProvider, state.focusedConfigField);
}

function renderProviderForm(provider) {
  const form = provider === "website" ? els.websiteConfigForm : els.miniappConfigForm;
  const container = provider === "website" ? els.websiteConfigFields : els.miniappConfigFields;
  const channel = channelFor(provider);
  const previewButton = document.querySelector(`[data-preview-provider="${provider}"]`);
  previewButton.disabled = !channel;
  form.reset();
  if (provider === "miniapp") renderMiniappCredentialForm(form);
  form.elements.enabled.checked = channel?.enabled !== false;
  const values = { ...(channel?.config || {}) };
  if (provider === "website" && (!values.employeeActionLabel || values.employeeActionLabel === "咨询")) values.employeeActionLabel = "在线";
  const fields = configFieldsFor(provider);
  if (provider === "website") {
    renderDynamicFields(els.websiteBackgroundFields, fields.filter((field) => WEBSITE_BACKGROUND_KEYS.has(field.key)), values);
    renderDynamicFields(container, fields.filter((field) => WEBSITE_CONFIG_KEYS.has(field.key)), values);
    syncWebsiteColorControls();
  } else renderDynamicFields(container, fields, values);
  const agentOverrideEnabled = Boolean(channel?.assistantAgentConfigId);
  form.elements.assistantAgentOverrideEnabled.checked = agentOverrideEnabled;
  delete form.elements.assistantAgentConfigId.dataset.overrideValue;
  renderAgentBindingSelect(form, "assistantAgentConfigId", agentOverrideEnabled, channel?.assistantAgentConfigId || "");
  if (!channel) {
    form.querySelectorAll("button, input, select, textarea").forEach((element) => { element.disabled = !element.matches('[type="submit"]'); });
  } else {
    form.elements.enabled.disabled = false;
    form.elements.assistantAgentOverrideEnabled.disabled = false;
    if (provider === "website") els.websiteBackgroundFields.querySelectorAll("button, input, select, textarea").forEach((element) => { element.disabled = false; });
    container.querySelectorAll("button, input, select, textarea").forEach((element) => { element.disabled = false; });
    form.querySelectorAll("button").forEach((button) => { button.disabled = false; });
  }
}

function renderMiniappCredentialForm(form) {
  const config = state.miniappConfig;
  setField(form, "miniappMode", config?.mode || "dedicated");
  setField(form, "miniappName", config?.name || `${state.workspace?.name || "公司"}小程序`);
  setField(form, "miniappAppId", config?.appId || "");
  setField(form, "miniappOriginalId", config?.originalId || "");
  form.elements.miniappAppSecret.value = "";
  form.elements.miniappAppSecret.required = !config?.appSecretConfigured;
  form.elements.miniappAppSecret.placeholder = config?.appSecretConfigured ? "已加密保存；留空表示不修改" : "填写后加密保存";
  const statusLabels = { verified: "已验证", configured: "待验证", error: "验证失败" };
  els.miniappCredentialStatus.textContent = statusLabels[config?.status] || "未配置";
  els.miniappCredentialStatus.className = `pill ${config?.status === "verified" ? "ok" : config ? "warn" : "off"}`;
  els.miniappCredentialHint.textContent = config?.verifiedAt ? `最近验证：${new Date(config.verifiedAt).toLocaleString("zh-CN")}` : "每个工作区独立保存，密钥不会返回浏览器。";
  els.verifyMiniappCredential.disabled = !config?.appSecretConfigured;
}

function fieldLabelMarkup(label, icon = "i-edit") {
  return `<span><svg><use href="#${icon}"/></svg>${escapeHtml(label)}</span>`;
}

function dynamicFieldIcon(field) {
  const key = String(field.key || "").toLowerCase();
  if (field.type === "image" || field.type === "video" || /avatar|cover|logo|poster/.test(key)) return "i-image";
  if (/url|website|domain/.test(key)) return "i-globe";
  if (/secret|key/.test(key)) return "i-key";
  if (/sort|order|limit/.test(key)) return "i-gauge";
  if (/title|job|role/.test(key)) return "i-briefcase";
  if (/name|person/.test(key)) return "i-user";
  if (field.type === "boolean" || field.type === "optional-boolean") return "i-settings";
  if (field.type === "list" || field.type === "resources") return "i-grid";
  return "i-edit";
}

function renderDynamicFields(container, fields, values) {
  container.innerHTML = fields.map((field) => {
    const value = values[field.key] ?? field.default;
    const label = fieldLabelMarkup(field.label, dynamicFieldIcon(field));
    const target = `data-template-target="${escapeHtml(field.key)}"`;
    const fieldClass = field.fullWidth ? "config-field-wide" : "";
    if (field.type === "hidden") return `<input data-config-key="${escapeHtml(field.key)}" data-config-type="hidden" type="hidden" value="${escapeHtml(value)}"/>`;
    if (field.type === "boolean") return `<label class="config-toggle" ${target}>${label}<input data-config-key="${field.key}" data-config-type="boolean" type="checkbox" ${value ? "checked" : ""}/><i aria-hidden="true"></i></label>`;
    if (field.type === "optional-boolean") return `<label class="${fieldClass}" ${target}>${label}<select data-config-key="${field.key}" data-config-type="optional-boolean"><option value="" ${value === "" || value == null ? "selected" : ""}>继承渠道设置</option><option value="true" ${value === true || value === "true" ? "selected" : ""}>启用</option><option value="false" ${value === false || value === "false" ? "selected" : ""}>停用</option></select></label>`;
    if (field.type === "select") return `<label class="${fieldClass}" ${target}>${label}<select data-config-key="${field.key}" data-config-type="select">${field.options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`;
    if (field.type === "video" || field.type === "image") {
      return mediaFieldMarkup({ key: field.key, label: field.label, kind: field.type, value: value || "", imageSpec: field.imageSpec, fullWidth: field.fullWidth });
    }
    const multiline = ["textarea", "list", "resources"].includes(field.type);
    const shown = field.type === "list" ? (Array.isArray(value) ? value.join("\n") : "") : field.type === "resources" ? (Array.isArray(value) ? value.map((item) => `${item.name || "资料"}|${item.url || ""}`).join("\n") : "") : value || "";
    const colorValue = field.colorKey ? values[field.colorKey] || field.colorDefault || "#27324a" : "";
    const colorControl = field.colorKey ? `<span class="inline-color-control" style="--inline-color:${escapeHtml(colorValue)}" title="修改${escapeHtml(field.label)}颜色"><input class="inline-color-input" data-config-key="${escapeHtml(field.colorKey)}" data-config-type="color" data-template-focus="${escapeHtml(field.colorKey)}" type="color" value="${escapeHtml(colorValue)}" aria-label="${escapeHtml(field.label)}颜色"/><i></i></span>` : "";
    const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : "";
    const pattern = field.pattern ? ` pattern="${escapeHtml(field.pattern)}"` : "";
    const input = multiline
      ? `<textarea rows="3" data-config-key="${field.key}" data-config-type="${field.type}"${placeholder}>${escapeHtml(shown)}</textarea>`
      : `<input data-config-key="${field.key}" data-config-type="${field.type}" type="${field.type === "color" ? "color" : field.type === "url" ? "url" : "text"}" value="${escapeHtml(shown)}"${placeholder}${pattern}/>`;
    return `<label class="${fieldClass} ${field.colorKey ? "has-inline-color" : ""}" ${target}>${label}<span class="config-input-shell">${input}${colorControl}</span></label>`;
  }).join("");
}

function mediaFieldMarkup({ key, label, kind, value = "", fixedName = "", imageSpec = null, fullWidth = false }) {
  const rule = ADMIN_MEDIA_RULES[kind];
  const target = fixedName
    ? `name="${escapeHtml(fixedName)}" data-fixed-media-value="${escapeHtml(fixedName)}"`
    : `data-config-key="${escapeHtml(key)}" data-config-type="${kind}"`;
  const uploadTarget = fixedName
    ? `data-fixed-media-upload="${escapeHtml(fixedName)}"`
    : `data-media-upload="${escapeHtml(key)}"`;
  const specAttributes = imageSpec ? `data-image-width="${imageSpec.width}" data-image-height="${imageSpec.height}" data-image-transparent="${imageSpec.transparent ? "true" : "false"}"` : "";
  const accept = imageSpec?.transparent ? "image/png,image/webp,.png,.webp" : rule.accept;
  const specMarkup = imageSpec ? `<small class="media-spec-note">规格 ${imageSpec.width}×${imageSpec.height}px · 1–${imageSpec.maxVisibleItems || 3} 人动态高度，更多员工内部滚动</small>` : "";
  return `<div class="media-config-field ${imageSpec ? "has-image-spec" : ""} ${fullWidth ? "wide" : ""}" data-media-field data-media-kind="${kind}" ${specAttributes} ${fixedName ? "" : `data-template-target="${escapeHtml(key)}"`}>
    ${fieldLabelMarkup(label, "i-image")}
    <input type="hidden" ${target} value="${escapeHtml(value)}"/>
    <div class="media-upload-content">
      <div class="media-asset-preview" data-media-preview>${mediaPreviewMarkup(kind, value)}</div>
      <div class="media-asset-copy"><strong data-media-state>${value ? "已上传" : "未上传"}</strong><small>${value ? escapeHtml(assetName(value)) : ""}</small>${specMarkup}</div>
      <label class="asset-file-button"><input type="file" ${uploadTarget} data-media-kind="${kind}" accept="${accept}" hidden/><span>${value ? `更换${rule.label}` : `上传${rule.label}`}</span></label>
      <button class="media-clear-button" type="button" data-media-clear ${value ? "" : "hidden"}>移除</button>
    </div>
  </div>`;
}

function fixedMediaFieldMarkup({ name, label, kind, value }) {
  return mediaFieldMarkup({ label, kind, value, fixedName: name });
}

function mediaPreviewMarkup(kind, value) {
  if (!value) return `<span>${kind === "video" ? "视频" : "图片"}</span>`;
  return kind === "video"
    ? `<video src="${escapeHtml(value)}" muted playsinline preload="metadata"></video>`
    : `<img src="${escapeHtml(value)}" alt=""/>`;
}

function assetName(value) {
  const clean = String(value || "").split(/[?#]/, 1)[0];
  const name = clean.split("/").filter(Boolean).at(-1) || "已上传文件";
  try { return decodeURIComponent(name); } catch { return name; }
}

async function validateMediaSpec(file, wrapper) {
  const width = Number(wrapper.dataset.imageWidth || 0);
  const height = Number(wrapper.dataset.imageHeight || 0);
  if (!width || !height) return;
  if (wrapper.dataset.imageTransparent === "true" && !["image/png", "image/webp"].includes(file.type)) throw new Error("定制客服框仅支持透明 PNG 或 WebP 图片");
  const dimensions = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      let hasTransparency = true;
      if (wrapper.dataset.imageTransparent === "true") {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        hasTransparency = false;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] < 255) { hasTransparency = true; break; }
        }
      }
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight, hasTransparency });
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("无法读取图片尺寸")); };
    image.src = url;
  });
  if (dimensions.width !== width || dimensions.height !== height) throw new Error(`定制客服框必须为 ${width}×${height}px，当前为 ${dimensions.width}×${dimensions.height}px`);
  if (!dimensions.hasTransparency) throw new Error("定制客服框必须包含透明区域，不能使用不透明底图");
}

function updateMediaField(wrapper, value) {
  const kind = wrapper.dataset.mediaKind;
  const rule = ADMIN_MEDIA_RULES[kind];
  wrapper.querySelector('input[type="hidden"]').value = value;
  wrapper.querySelector("[data-media-preview]").innerHTML = mediaPreviewMarkup(kind, value);
  wrapper.querySelector("[data-media-state]").textContent = value ? "已上传" : "未上传";
  wrapper.querySelector(".media-asset-copy small").textContent = value ? assetName(value) : "";
  wrapper.querySelector(".asset-file-button > span").textContent = value ? `更换${rule.label}` : `上传${rule.label}`;
  wrapper.querySelector("[data-media-clear]").hidden = !value;
  wrapper.querySelector('input[type="hidden"]').dispatchEvent(new Event("input", { bubbles: true }));
}

function readDynamicFields(container) {
  return Object.fromEntries([...container.querySelectorAll("[data-config-key]")].map((field) => {
    let value = field.type === "checkbox" ? field.checked : field.value.trim();
    if (field.dataset.configType === "hidden" && value !== "") value = Number(value);
    if (field.dataset.configType === "optional-boolean") value = value === "" ? null : value === "true";
    if (field.dataset.configType === "list") value = value.split("\n").map((item) => item.trim()).filter(Boolean);
    if (field.dataset.configType === "resources") value = value.split("\n").map((item) => { const [name, ...url] = item.split("|"); return { name: name.trim(), url: url.join("|").trim() }; }).filter((item) => item.name && item.url);
    return [field.dataset.configKey, value];
  }));
}

function renderFieldMap(provider, key = "") {
  const map = provider === "website" ? els.websiteFieldMap : els.miniappFieldMap;
  document.querySelectorAll("[data-template-slot], [data-color-slot]").forEach((slot) => slot.classList.remove("is-focused"));
  if (key) map.querySelectorAll(`[data-template-slot="${CSS.escape(key)}"], [data-color-slot="${CSS.escape(key)}"]`).forEach((slot) => slot.classList.add("is-focused"));
  els.fieldMapHint.textContent = key ? "已定位当前字段，修改内容可实时查看" : provider === "website" ? "桌面端模板 · 配置内容实时同步" : "正面是员工名片，反面是公司助手，可点击切换";
  syncFieldMapValues(provider);
  if (provider !== "website") {
    if (key) setMiniappMapFace(key === "coverUrl" ? "front" : "back");
    else setMiniappMapFace(state.miniappMapFace);
    const values = fieldMapValues("miniapp");
    const showPoster = key === "assistantScenePosterUrl" && values.assistantScenePosterUrl;
    const showFallback = key === "assistantMascotImageUrl" && values.assistantMascotImageUrl;
    els.mapAssistantVideo.hidden = showPoster || showFallback || !values.assistantSceneVideoUrl;
    els.mapAssistantPoster.hidden = showFallback || (!showPoster && Boolean(values.assistantSceneVideoUrl));
    els.miniappFieldMap.querySelector(".map-assistant-fallback").hidden = !showFallback;
    return;
  }
}

function fieldMapValues(provider) {
  if (provider === "website") return { ...readDynamicFields(els.websiteBackgroundFields), ...readDynamicFields(els.websiteConfigFields) };
  return { ...(channelFor("miniapp")?.config || {}), ...readDynamicFields(els.miniappConfigFields) };
}

function syncFieldMapValues(provider) {
  const map = provider === "website" ? els.websiteFieldMap : els.miniappFieldMap;
  const values = fieldMapValues(provider);
  map.querySelectorAll("[data-live-text]").forEach((node) => {
    const value = values[node.dataset.liveText];
    node.textContent = Array.isArray(value) ? value.join(" · ") : value || node.dataset.emptyText || "未配置";
  });
  map.querySelectorAll("[data-live-image]").forEach((image) => {
    const value = values[image.dataset.liveImage] || "";
    if (value) image.src = value;
    else image.removeAttribute("src");
  });
  map.querySelectorAll("[data-live-color]").forEach((node) => {
    const value = values[node.dataset.liveColor];
    node.style.color = /^#[0-9a-f]{6}$/i.test(value || "") ? value : "";
  });
  if (provider === "website") {
    const homepageImage = values.homepageImageUrl || "/console/assets/moosee-work-serious-scene.png";
    els.websiteFieldMap.querySelector(".map-site-hero").style.setProperty("--map-homepage-image", `url("${String(homepageImage).replace(/["\\]/g, "")}")`);
    const people = state.people.filter((person) => person.enabled !== false);
    const samplePeople = people.length ? people : [
      { name: "张三", title: "客户经理", avatarUrl: "" },
      { name: "李四", title: "产品经理", avatarUrl: "" }
    ];
    const actionLabel = values.employeeActionLabel || "在线";
    els.mapRosterCount.textContent = `${people.length || samplePeople.length} 位在线`;
    els.websiteRosterMap.style.setProperty("--map-panel-header", "#ffffff");
    els.websiteRosterMap.style.setProperty("--map-panel-background", "#f5f7fa");
    els.websiteRosterMap.style.setProperty("--map-panel-border", safeMapColor(values.panelBorderColor, "#d7deea"));
    els.websiteRosterMap.style.setProperty("--map-action-color", safeMapColor(values.employeeActionColor, "#176b54"));
    const autoItemColor = values.employeeItemColorAuto !== false;
    const itemColor = autoItemColor
      ? safeMapColor(state.workspace?.accent, "#315ee8")
      : safeMapColor(values.employeeItemColor, safeMapColor(state.workspace?.accent, "#315ee8"));
    els.websiteRosterMap.style.setProperty("--map-brand-color", itemColor);
    const panelSkin = values.panelSkinImageUrl || "";
    els.websiteRosterMap.classList.toggle("has-custom-skin", Boolean(panelSkin));
    els.websiteRosterMap.style.setProperty("--map-panel-skin", panelSkin ? `url("${String(panelSkin).replace(/["\\]/g, "")}")` : "none");
    syncMapSkinTone(panelSkin, autoItemColor);
    els.websiteRosterMap.style.setProperty("--map-visible-agents", String(Math.max(1, Math.min(samplePeople.length, 3))));
    els.websiteRosterMap.dataset.shape = values.panelShape || "轻圆角";
    els.websiteRosterMap.dataset.avatarShape = values.employeeAvatarShape || "圆形";
    els.mapRosterPeople.innerHTML = samplePeople.map((person) => `<div class="map-roster-person">${person.avatarUrl ? `<img data-template-slot="employeeAvatarShape" src="${escapeHtml(person.avatarUrl)}" alt=""/>` : `<i data-template-slot="employeeAvatarShape">${escapeHtml((person.name || "人").slice(0, 1))}</i>`}<span><strong>${escapeHtml(person.name || "张三")}</strong><small>${escapeHtml(person.title || "智能员工")}</small></span><b data-template-slot="employeeActionLabel" data-color-slot="employeeActionColor"><i></i>${escapeHtml(actionLabel)}</b></div>`).join("");
    return;
  }
  const topics = Array.isArray(values.assistantTopics) ? values.assistantTopics : [];
  els.mapAssistantTopics.innerHTML = topics.slice(0, 4).map((item, index) => `<span class="topic-${index + 1}">${escapeHtml(item)}<i>›</i></span>`).join("");
  const primaryItems = Array.isArray(values.assistantPrimaryItems) ? values.assistantPrimaryItems : [];
  const recommendedItems = Array.isArray(values.assistantRecommendedItems) ? values.assistantRecommendedItems : [];
  const shortcutRows = (items, marks) => (items.length ? items : ["未配置"]).slice(0, 3).map((item, index) => `<span><i>${marks[index] || "·"}</i><b>${escapeHtml(item)}</b><em>›</em></span>`).join("");
  els.mapAssistantPrimaryItems.innerHTML = shortcutRows(primaryItems, ["D", "礼", "荐"]);
  els.mapAssistantRecommendedItems.innerHTML = shortcutRows(recommendedItems, ["新", "企", "约"]);
  const poster = values.assistantScenePosterUrl || "";
  if (poster) els.mapAssistantPoster.src = poster;
  else els.mapAssistantPoster.removeAttribute("src");
  const video = values.assistantSceneVideoUrl || "";
  if (video && els.mapAssistantVideo.src !== new URL(video, location.href).href) els.mapAssistantVideo.src = video;
  if (!video) els.mapAssistantVideo.removeAttribute("src");
  els.mapAssistantVideo.hidden = !video;
  els.mapAssistantPoster.hidden = Boolean(video);
  els.miniappFieldMap.querySelector(".map-assistant-fallback").hidden = Boolean(video || poster);
  els.miniappFieldMap.querySelector(".map-card-lead").hidden = values.leadFormEnabled === false;
  els.miniappFieldMap.querySelector(".map-card-composer span").hidden = values.voiceEnabled === false;
  const person = state.people.find((item) => item.enabled !== false) || state.people[0] || { name: "张三", title: "智能员工", avatarUrl: "", profile: {} };
  els.mapPersonName.textContent = person.name || "张三";
  els.mapPersonTitle.textContent = person.title || "智能员工";
  els.mapPersonCompany.textContent = state.workspace?.name || "公司名称";
  els.mapPersonAvatar.innerHTML = person.avatarUrl ? `<img src="${escapeHtml(person.avatarUrl)}" alt=""/>` : escapeHtml((person.name || "人").slice(0, 1));
  els.mapBackPersonName.textContent = person.name || "张三";
  if (person.avatarUrl) els.mapBackPersonAvatar.src = person.avatarUrl;
  else els.mapBackPersonAvatar.removeAttribute("src");
  const legacyCover = "/console/assets/moosee-work-serious-scene.png";
  const personCover = person.profile?.coverUrl && person.profile.coverUrl !== legacyCover ? person.profile.coverUrl : "";
  const cover = personCover || values.coverUrl || "/console/assets/xiaoding-card-hero-v1.webp";
  els.mapPersonHero.style.setProperty("--map-person-cover", `url("${String(cover).replace(/["\\]/g, "")}")`);
  els.mapFrontAssistantName.textContent = values.assistantName || "D仔";
  if (values.assistantAvatarUrl) els.mapFrontAssistantAvatar.src = values.assistantAvatarUrl;
  else els.mapFrontAssistantAvatar.removeAttribute("src");
}

function setMiniappMapFace(face) {
  state.miniappMapFace = face === "front" ? "front" : "back";
  document.querySelectorAll("[data-miniapp-map-face]").forEach((button) => button.classList.toggle("active", button.dataset.miniappMapFace === state.miniappMapFace));
  document.querySelectorAll("[data-miniapp-map-panel]").forEach((panel) => { panel.hidden = panel.dataset.miniappMapPanel !== state.miniappMapFace; });
}

function previewUrlFor(provider) {
  const channel = channelFor(provider);
  if (!channel) return "";
  const deployment = state.deployments.find((item) => item.workspaceChannelId === channel.id && item.enabled);
  if (deployment) {
    return `/channels/${encodeURIComponent(deployment.publicSlug)}?deployment=${encodeURIComponent(deployment.id)}&preview=draft&t=${Date.now()}-${++previewRevision}`;
  }
  return `/channels/channel-preview?channel=${encodeURIComponent(channel.id)}&preview=draft&t=${Date.now()}-${++previewRevision}`;
}

function websiteDeployment() {
  const channel = channelFor("website");
  return channel?.publishedVersion > 0 && state.deployments.find((item) => item.workspaceChannelId === channel.id && item.enabled && item.publicSlug);
}

function websiteEmbedCode() {
  const channel = channelFor("website");
  const deployment = websiteDeployment();
  if (!channel || !deployment) return "";
  return `<script async src="${location.origin}/embed/dclaw-agent.js" data-channel="${channel.id}"><\/script>`;
}

function closeWebsiteDeployDialog() {
  document.querySelector("#websiteDeployDialog")?.remove();
}

function openWebsiteDeployDialog() {
  closeWebsiteDeployDialog();
  const deployment = websiteDeployment();
  if (!deployment) return toast("请先发布官网配置并开通至少一位智能员工");
  const channel = channelFor("website");
  const code = websiteEmbedCode();
  const previewUrl = `${location.origin}/channels/${encodeURIComponent(channel.id)}`;
  const dialog = document.createElement("div");
  dialog.id = "websiteDeployDialog";
  dialog.className = "deploy-dialog-backdrop";
  dialog.innerHTML = `<section class="deploy-dialog" role="dialog" aria-modal="true" aria-labelledby="websiteDeployTitle">
    <header><span><svg><use href="#i-link"/></svg><strong id="websiteDeployTitle">部署官网客服</strong></span><button type="button" data-deploy-close aria-label="关闭">×</button></header>
    <div class="deploy-steps"><span><i>1</i>复制代码</span><b></b><span><i>2</i>粘贴到官网 &lt;/body&gt; 前</span></div>
    <label class="deploy-code"><span>接入代码</span><textarea readonly rows="4">${escapeHtml(code)}</textarea></label>
    <footer><a class="secondary" href="${escapeHtml(previewUrl)}" target="_blank" rel="noopener"><svg><use href="#i-eye"/></svg>查看页面</a><button class="primary" type="button" data-copy-embed><svg><use href="#i-copy"/></svg>复制代码</button></footer>
  </section>`;
  document.body.append(dialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest("[data-deploy-close]")) closeWebsiteDeployDialog();
    if (event.target.closest("[data-copy-embed]")) copyWebsiteEmbedCode().catch(handleError);
  });
}

async function copyWebsiteEmbedCode() {
  const code = websiteEmbedCode();
  if (!code) throw new Error("暂无可部署的官网客服");
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(code);
  else {
    const input = document.querySelector("#websiteDeployDialog textarea");
    input.focus();
    input.select();
    if (!document.execCommand("copy")) throw new Error("复制失败，请手动选择代码");
  }
  toast("接入代码已复制");
}

function defaultAgent() {
  return state.agentConfigs.find((item) => item.id === state.agentDefaults.defaultAgentConfigId) || null;
}

function agentBindingOptions(selected = "", overrideEnabled = false) {
  const inherited = defaultAgent();
  if (!overrideEnabled) {
    return inherited
      ? `<option value="${escapeHtml(inherited.id)}" selected>${escapeHtml(inherited.name)}（平台默认）</option>`
      : '<option value="" selected>暂无默认 Agent</option>';
  }
  const activeId = selected || inherited?.id || "";
  return state.agentConfigs.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === activeId ? "selected" : ""}>${escapeHtml(item.name)}${item.isDefault ? "（平台默认）" : ""}</option>`).join("");
}

function renderAgentBindingSelect(form, selectName, overrideEnabled, selected = "") {
  const select = form.elements[selectName];
  if (overrideEnabled && selected) select.dataset.overrideValue = selected;
  select.innerHTML = agentBindingOptions(selected, overrideEnabled);
  select.disabled = !overrideEnabled || !state.agentConfigs.length;
  select.closest(".agent-binding-block")?.classList.toggle("is-inherited", !overrideEnabled);
}

function agentDefaultOptions(selected = "") {
  return state.agentConfigs.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
}

function renderAgentLibrary() {
  els.agentDefaultsForm.elements.defaultAgentConfigId.innerHTML = agentDefaultOptions(state.agentDefaults.defaultAgentConfigId);
  els.agentConfigList.innerHTML = state.agentConfigs.map((item) => {
    const endpoint = (() => { try { return new URL(item.agentApiUrl).host; } catch { return item.agentApiUrl || "未配置 OpenAPI"; } })();
    return `<article class="agent-config-card ${item.id === state.agentConfig?.id && !state.creatingAgentConfig ? "active" : ""} ${item.isDefault ? "is-default" : ""}">
      <button type="button" data-agent-config-id="${escapeHtml(item.id)}">
        <span class="agent-card-head"><span class="agent-card-mark"><svg><use href="#i-bot"/></svg></span><span class="agent-card-title"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.id)}</small></span>${item.isDefault ? '<i class="agent-default-badge">默认</i>' : ""}</span>
        <span class="agent-card-meta"><span><svg><use href="#i-globe"/></svg>${escapeHtml(endpoint)}</span><span><svg><use href="#i-bot"/></svg>${escapeHtml(item.agentId || "未配置 Agent ID")}</span></span>
      </button>
    </article>`;
  }).join("") || '<div class="list-empty">暂无 Agent 配置</div>';

  const form = els.agentConfigForm;
  const config = state.creatingAgentConfig ? null : state.agentConfig;
  form.reset();
  setField(form, "id", config?.id || "");
  form.elements.id.disabled = Boolean(config);
  setField(form, "name", config?.name || "");
  setField(form, "agentApiUrl", config?.agentApiUrl || "");
  setField(form, "agentId", config?.agentId || "");
  form.elements.agentApiKey.placeholder = config?.agentApiKeyConfigured ? "已配置" : "";
  els.deleteAgentConfig.hidden = !config || config.isDefault;
}

function startWorkspace() {
  state.creatingWorkspace = true;
  state.workspace = null;
  els.adminEmpty.hidden = true;
  els.workspaceShell.hidden = false;
  els.workspaceTitle.textContent = "工作区 / 新建工作区";
  els.workspaceStatus.textContent = "待创建";
  activateTab("workspace");
  renderWorkspaceList();
  renderWorkspaceForm();
  renderAgentLibrary();
}

async function saveWorkspace(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = { id: form.elements.id.value, slug: form.elements.slug.value, name: form.elements.name.value, logoUrl: form.elements.logoUrl.value, enabled: state.creatingWorkspace ? true : state.workspace.enabled, companyContext: { industry: form.elements.industry.value, description: form.elements.description.value } };
  if (form.elements.adminPassword.value) body.adminPassword = form.elements.adminPassword.value;
  if (state.creatingWorkspace) {
    state.workspace = await api("/api/admin/workspaces", { method: "POST", body });
    await Promise.all([
      api(`/api/admin/workspaces/${encodeURIComponent(state.workspace.id)}/channels`, { method: "POST", body: { id: `${state.workspace.id.slice(0, 72)}-website`, provider: "website", name: "官网客服", enabled: true, config: {} } }),
      api(`/api/admin/workspaces/${encodeURIComponent(state.workspace.id)}/channels`, { method: "POST", body: { id: `${state.workspace.id.slice(0, 72)}-miniapp`, provider: "miniapp", name: "智能名片", enabled: true, config: {} } })
    ]);
  } else state.workspace = await api(`/api/admin/workspaces/${encodeURIComponent(state.workspace.id)}`, { method: "PUT", body });
  state.workspaces = (await api("/api/admin/workspaces")).items;
  await loadWorkspaceContext();
  toast("工作区已保存");
}

async function savePerson(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = { id: form.elements.id.value, name: form.elements.name.value, title: form.elements.title.value, avatarUrl: form.elements.avatarUrl.value, agentConfigId: form.elements.agentOverrideEnabled.checked ? form.elements.agentConfigId.value : "", persona: { personality: form.elements.personality.value, speakingStyle: form.elements.speakingStyle.value, responsibilities: form.elements.responsibilities.value, systemPrompt: form.elements.systemPrompt.value }, profile: readDynamicFields(els.personProfileFields) };
  if (state.creatingPerson) state.person = await api(`/api/admin/workspaces/${encodeURIComponent(state.workspace.id)}/people`, { method: "POST", body });
  else state.person = await api(`/api/admin/people/${encodeURIComponent(state.person.id)}`, { method: "PUT", body });
  await loadWorkspaceContext();
  toast("智能员工已保存");
}

async function saveProviderConfig(event, provider) {
  event.preventDefault();
  const form = event.currentTarget;
  await persistProviderConfig(provider, form);
  await loadWorkspaceContext();
  toast(`${provider === "website" ? "官网客服" : "智能名片"}配置已保存，可点击预览`);
}

async function persistProviderConfig(provider, form) {
  const channel = channelFor(provider);
  if (!channel) throw new Error(`${provider === "website" ? "官网客服" : "智能名片"}尚未初始化`);
  const container = provider === "website" ? els.websiteConfigFields : els.miniappConfigFields;
  const body = {
    enabled: form.elements.enabled.checked,
    assistantAgentConfigId: form.elements.assistantAgentOverrideEnabled.checked ? form.elements.assistantAgentConfigId.value : "",
    config: {
      ...(channel.config || {}),
      ...(provider === "website" ? readDynamicFields(els.websiteBackgroundFields) : {}),
      ...readDynamicFields(container)
    }
  };
  if (provider === "website") {
    delete body.config.panelHeaderColor;
    delete body.config.panelBackgroundColor;
  }
  if (provider === "miniapp") {
    await persistMiniappCredential(form);
  }
  await api(`/api/admin/channels/${encodeURIComponent(channel.id)}`, { method: "PUT", body });
  return channel;
}

function miniappCredentialBody(form = els.miniappConfigForm) {
  const body = {
    mode: form.elements.miniappMode.value,
    name: form.elements.miniappName.value,
    appId: form.elements.miniappAppId.value,
    originalId: form.elements.miniappOriginalId.value
  };
  if (form.elements.miniappAppSecret.value) body.appSecret = form.elements.miniappAppSecret.value;
  return body;
}

async function persistMiniappCredential(form = els.miniappConfigForm) {
  state.miniappConfig = await api(`/api/admin/workspaces/${encodeURIComponent(state.workspace.id)}/miniapp`, {
    method: "PUT",
    body: miniappCredentialBody(form)
  });
  return state.miniappConfig;
}

async function saveMiniappCredential() {
  if (!els.miniappConfigForm.reportValidity()) return;
  await persistMiniappCredential();
  renderMiniappCredentialForm(els.miniappConfigForm);
  toast("小程序配置已保存");
}

async function publishProviderConfig(provider) {
  const form = provider === "website" ? els.websiteConfigForm : els.miniappConfigForm;
  if (!form.reportValidity()) return;
  const channel = await persistProviderConfig(provider, form);
  await api(`/api/admin/channels/${encodeURIComponent(channel.id)}/publish`, { method: "POST" });
  await loadWorkspaceContext();
  toast("当前配置已保存并发布");
  if (provider === "website") openWebsiteDeployDialog();
}

async function verifyMiniappCredential() {
  if (!state.workspace || !state.miniappConfig) return;
  await api(`/api/admin/workspaces/${encodeURIComponent(state.workspace.id)}/miniapp/verify`, { method: "POST" });
  await loadWorkspaceContext();
  toast("微信小程序配置验证通过");
}

async function reloadAgentConfigs(selectedId = state.agentConfig?.id) {
  const result = await api("/api/admin/agents");
  state.agentConfigs = result.items;
  state.agentDefaults = result.defaults;
  state.agentConfig = state.agentConfigs.find((item) => item.id === selectedId) || state.agentConfigs[0] || null;
  state.creatingAgentConfig = false;
  renderAgentLibrary();
  renderPersonForm();
  renderConfiguration();
}

async function saveAgentConfig(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = { id: form.elements.id.value, name: form.elements.name.value, agentApiUrl: form.elements.agentApiUrl.value, agentId: form.elements.agentId.value };
  if (form.elements.agentApiKey.value) body.agentApiKey = form.elements.agentApiKey.value;
  const saved = state.creatingAgentConfig
    ? await api("/api/admin/agents", { method: "POST", body })
    : await api(`/api/admin/agents/${encodeURIComponent(state.agentConfig.id)}`, { method: "PUT", body });
  await reloadAgentConfigs(saved.id);
  toast("Agent 配置已保存");
}

async function saveAgentDefaults(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const result = await api("/api/admin/agent-defaults", { method: "PUT", body: { defaultAgentConfigId: form.elements.defaultAgentConfigId.value } });
  state.agentDefaults = result.defaults;
  await reloadAgentConfigs();
  toast("默认 Agent 已保存");
}

async function deleteAgentConfig() {
  if (!state.agentConfig) return;
  await api(`/api/admin/agents/${encodeURIComponent(state.agentConfig.id)}`, { method: "DELETE" });
  await reloadAgentConfigs("");
  toast("Agent 配置已删除");
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

async function toggleAdminItem(collection, id, enabled, endpoint, label) {
  const current = state[collection].find((item) => item.id === id);
  if (!current) return;
  await api(endpoint, { method: "PUT", body: { enabled } });
  current.enabled = enabled;
  toast(`${label(current)}已${enabled ? "启用" : "停用"}`);
}

async function togglePersonChannel(channelId, enabled) {
  const channel = state.channels.find((item) => item.id === channelId);
  if (!channel || !state.person) return;
  const existing = state.deployments.find((item) => item.personId === state.person.id && item.workspaceChannelId === channelId);
  if (existing) {
    await api(`/api/admin/deployments/${encodeURIComponent(existing.id)}`, { method: "PUT", body: { enabled } });
  } else if (enabled) {
    const id = `${state.person.id}-${channel.id}`.slice(0, 80).replace(/-+$/, "");
    await api(`/api/admin/workspaces/${encodeURIComponent(state.workspace.id)}/deployments`, { method: "POST", body: {
      id,
      workspaceChannelId: channel.id,
      personId: state.person.id,
      publicSlug: id,
      enabled: true,
      sortOrder: state.deployments.filter((item) => item.workspaceChannelId === channel.id).length * 10,
      config: {}
    } });
  }
  await loadWorkspaceContext();
  toast(`${channel.name}已${enabled ? "开通" : "停用"}`);
}

function activateTab(tab) {
  document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item.dataset.tab === tab));
  document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
  document.querySelector(".contextual-titlebar").hidden = tab === "workspace" || tab === "agent";
}

function bindEvents() {
  els.loginForm.addEventListener("submit", (event) => login(event).catch(handleError));
  els.logoutButton.addEventListener("click", () => logout().catch(handleError));
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
  els.workspaceList.addEventListener("click", (event) => { const button = event.target.closest("[data-workspace-id]"); if (!button) return; state.workspace = state.workspaces.find((item) => item.id === button.dataset.workspaceId); loadWorkspaceContext().catch(handleError); });
  els.workspaceList.addEventListener("change", (event) => { const toggle = event.target.closest("[data-workspace-toggle]"); if (!toggle) return; toggleWorkspace(toggle.dataset.workspaceToggle, toggle.checked).catch((error) => { toggle.checked = !toggle.checked; handleError(error); }); });
  els.personList.addEventListener("click", (event) => { const button = event.target.closest("[data-person-id]"); if (!button) return; state.person = state.people.find((item) => item.id === button.dataset.personId); state.creatingPerson = false; renderPeople(); });
  els.personList.addEventListener("change", (event) => { const toggle = event.target.closest("[data-person-toggle]"); if (!toggle) return; toggleAdminItem("people", toggle.dataset.personToggle, toggle.checked, `/api/admin/people/${encodeURIComponent(toggle.dataset.personToggle)}`, (item) => item.name).then(() => { toggle.closest("label").title = `${toggle.checked ? "停用" : "启用"}${state.people.find((item) => item.id === toggle.dataset.personToggle)?.name || "人物"}`; }).catch((error) => { toggle.checked = !toggle.checked; handleError(error); }); });
  els.personChannelList.addEventListener("change", (event) => { const toggle = event.target.closest("[data-person-channel-toggle]"); if (!toggle) return; togglePersonChannel(toggle.dataset.personChannelToggle, toggle.checked).catch((error) => { toggle.checked = !toggle.checked; handleError(error); }); });
  els.newWorkspace.addEventListener("click", startWorkspace);
  els.newPerson.addEventListener("click", () => { state.creatingPerson = true; state.person = null; renderPeople(); els.personForm.elements.id.focus(); });
  els.newAgentConfig.addEventListener("click", () => { state.creatingAgentConfig = true; state.agentConfig = null; renderAgentLibrary(); els.agentConfigForm.elements.id.focus(); });
  els.agentConfigList.addEventListener("click", (event) => { const button = event.target.closest("[data-agent-config-id]"); if (!button) return; state.agentConfig = state.agentConfigs.find((item) => item.id === button.dataset.agentConfigId); state.creatingAgentConfig = false; renderAgentLibrary(); });
  document.querySelectorAll("[data-config-provider]").forEach((button) => button.addEventListener("click", () => { state.focusedConfigField = ""; activateConfigProvider(button.dataset.configProvider); }));
  document.querySelectorAll("[data-miniapp-map-face]").forEach((button) => button.addEventListener("click", () => setMiniappMapFace(button.dataset.miniappMapFace)));
  els.personForm.elements.agentOverrideEnabled.addEventListener("change", (event) => {
    const select = els.personForm.elements.agentConfigId;
    if (!event.currentTarget.checked) select.dataset.overrideValue = select.value;
    renderAgentBindingSelect(els.personForm, "agentConfigId", event.currentTarget.checked, select.dataset.overrideValue || state.person?.agentConfigId || "");
  });
  ["website", "miniapp"].forEach((provider) => {
    const form = provider === "website" ? els.websiteConfigForm : els.miniappConfigForm;
    const containers = provider === "website" ? [els.websiteBackgroundFields, els.websiteConfigFields] : [els.miniappConfigFields];
    form.elements.assistantAgentOverrideEnabled.addEventListener("change", (event) => {
      const select = form.elements.assistantAgentConfigId;
      if (!event.currentTarget.checked) select.dataset.overrideValue = select.value;
      renderAgentBindingSelect(form, "assistantAgentConfigId", event.currentTarget.checked, select.dataset.overrideValue || channelFor(provider)?.assistantAgentConfigId || "");
    });
    form.addEventListener("submit", (event) => saveProviderConfig(event, provider).catch(handleError));
    containers.forEach((container) => {
      container.addEventListener("focusin", (event) => {
        const field = event.target.closest("[data-config-key]");
        const target = event.target.closest("[data-template-target]") || field?.closest("[data-template-target]");
        if (!target) return;
        state.focusedConfigField = field?.dataset.templateFocus || target.dataset.templateTarget;
        renderFieldMap(provider, state.focusedConfigField);
      });
      container.addEventListener("click", (event) => {
        const target = event.target.closest("[data-template-target]");
        if (!target) return;
        state.focusedConfigField = target.dataset.templateTarget;
        renderFieldMap(provider, state.focusedConfigField);
      });
      const syncConfigInput = (event) => {
        if (event.target.matches(".inline-color-input")) event.target.closest(".inline-color-control")?.style.setProperty("--inline-color", event.target.value);
        if (provider === "website" && event.target.matches('[data-config-key="employeeItemColorAuto"]')) syncWebsiteColorControls();
        renderFieldMap(provider, state.focusedConfigField);
      };
      container.addEventListener("input", syncConfigInput);
      container.addEventListener("change", syncConfigInput);
    });
  });
  const handleMediaUpload = (event) => {
    const input = event.target.closest("[data-media-upload], [data-fixed-media-upload]");
    if (!input?.files?.[0]) return;
    const wrapper = input.closest(".media-config-field");
    wrapper.classList.add("is-uploading");
    validateMediaSpec(input.files[0], wrapper).then(() => uploadAdminAsset(input.files[0], input.dataset.mediaKind)).then((asset) => {
      updateMediaField(wrapper, asset.url);
      toast(`${asset.type === "video" ? "视频" : "图片"}已上传，保存配置后生效`);
    }).catch(handleError).finally(() => {
      wrapper.classList.remove("is-uploading");
      input.value = "";
    });
  };
  const handleMediaClear = (event) => {
    const button = event.target.closest("[data-media-clear]");
    if (!button) return;
    updateMediaField(button.closest("[data-media-field]"), "");
  };
  els.websiteConfigFields.addEventListener("change", handleMediaUpload);
  els.websiteBackgroundFields.addEventListener("change", handleMediaUpload);
  els.miniappConfigFields.addEventListener("change", handleMediaUpload);
  els.workspaceForm.addEventListener("change", handleMediaUpload);
  els.personForm.addEventListener("change", handleMediaUpload);
  els.websiteConfigFields.addEventListener("click", handleMediaClear);
  els.websiteBackgroundFields.addEventListener("click", handleMediaClear);
  els.miniappConfigFields.addEventListener("click", handleMediaClear);
  els.workspaceForm.addEventListener("click", handleMediaClear);
  els.personForm.addEventListener("click", handleMediaClear);
  els.workspaceForm.addEventListener("submit", (event) => saveWorkspace(event).catch(handleError));
  els.personForm.addEventListener("submit", (event) => savePerson(event).catch(handleError));
  document.querySelectorAll("[data-publish-provider]").forEach((button) => button.addEventListener("click", () => publishProviderConfig(button.dataset.publishProvider).catch(handleError)));
  document.querySelectorAll("[data-deploy-provider='website']").forEach((button) => button.addEventListener("click", openWebsiteDeployDialog));
  document.querySelectorAll("[data-preview-provider]").forEach((button) => button.addEventListener("click", () => {
    const url = previewUrlFor(button.dataset.previewProvider);
    if (url) window.open(url, "_blank", "noopener");
  }));
  els.agentConfigForm.addEventListener("submit", (event) => saveAgentConfig(event).catch(handleError));
  els.agentDefaultsForm.addEventListener("submit", (event) => saveAgentDefaults(event).catch(handleError));
  els.deleteAgentConfig.addEventListener("click", () => deleteAgentConfig().catch(handleError));
  els.saveMiniappCredential.addEventListener("click", () => saveMiniappCredential().catch(handleError));
  els.verifyMiniappCredential.addEventListener("click", () => verifyMiniappCredential().catch(handleError));

}

function setField(form, name, value) {
  const field = form.elements[name];
  if (!field) return;
  field.value = value ?? "";
  if (field instanceof HTMLSelectElement) syncUnifiedSelect(field);
}
function toast(message) { els.toast.textContent = message; els.toast.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { els.toast.hidden = true; }, 2600); }
function handleError(error) { console.error(error); toast(localizedErrorMessage(error?.message || error)); }

bootstrap().catch(handleError);
