export function createTagEditor({ api, toast, icon, escapeHtml, getAccountId, onChanged = () => {} }) {
  const list = document.querySelector("#tagGroupList");
  const collapsed = new Set();
  let schema = defaultSchema();

  const activationMessage = () => ({ content: "", intervalMinutes: 30, maxTimes: 1 });
  const activation = (value = {}) => ({
    enabled: Boolean(value.enabled),
    polishByAgent: value.polishByAgent !== false,
    messages: Array.isArray(value.messages) ? value.messages.map((item) => ({
      content: String(item?.content || ""),
      intervalMinutes: Math.max(0, Number.parseInt(item?.intervalMinutes ?? 30, 10) || 0),
      maxTimes: Math.max(1, Number.parseInt(item?.maxTimes ?? 1, 10) || 1)
    })) : []
  });

  function defaultSchema() {
    return { version: "1.0.0", dateTag: { enabled: true, cutoffTime: "00:00", effectiveAt: "" }, groups: [] };
  }

  function normalize(value = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      version: String(source.version || "1.0.0"),
      dateTag: { enabled: true, cutoffTime: /^\d{2}:\d{2}$/.test(source.dateTag?.cutoffTime || "") ? source.dateTag.cutoffTime : "00:00", effectiveAt: String(source.dateTag?.effectiveAt || "") },
      groups: Array.isArray(source.groups) ? source.groups.map((group, groupIndex) => ({
        id: String(group.id || `group_${groupIndex + 1}`).trim(),
        name: String(group.name || `标签组 ${groupIndex + 1}`).trim(),
        enabled: group.enabled !== false,
        exclusive: group.exclusive !== false,
        oneWay: Boolean(group.oneWay),
        tags: Array.isArray(group.tags) ? group.tags.map((tag, tagIndex) => ({
          id: String(tag.id || `tag_${tagIndex + 1}`).trim(),
          name: String(tag.name || `标签 ${tagIndex + 1}`).trim(),
          condition: String(tag.condition || ""),
          evidenceMode: tag.evidenceMode === "system" ? "system" : "customer",
          enabled: tag.enabled !== false,
          voiceAlertEnabled: Boolean(tag.voiceAlertEnabled),
          handoffEnabled: Boolean(tag.handoffEnabled),
          activation: activation(tag.activation)
        })) : []
      })) : []
    };
  }

  function nextId(prefix, values, start) {
    let index = Math.max(1, start);
    const used = new Set(values);
    while (used.has(`${prefix}_${index}`)) index += 1;
    return `${prefix}_${index}`;
  }

  function renderDateTag() {
    return `
      <article class="tag-group-card date-tag-special-group">
        <div class="tag-group-head">
          <label class="toggle switch-toggle tag-group-enabled-toggle"><input type="checkbox" checked disabled aria-label="添加日期标签始终启用" /><span class="switch-slider"></span><span class="switch-label">启用</span></label>
          <div class="field-row date-tag-name-field"><span class="field-label">${icon("tag")}标签组</span><strong class="field-control">添加日期</strong></div>
          <label class="date-tag-cutoff-field"><span class="field-label">${icon("clock")}日切时间</span><input id="dateTagCutoffTime" type="time" step="60" value="${escapeHtml(schema.dateTag.cutoffTime)}" /></label>
          <button class="activation-help-icon date-tag-help" type="button" title="日切时间决定添加日期标签何时进入下一天；00:00 表示自然日。">${icon("info")}</button>
        </div>
      </article>`;
  }

  function renderTag(group, groupIndex, tag, tagIndex) {
    const task = activation(tag.activation);
    const messages = task.messages.length ? task.messages : [activationMessage()];
    return `
      <article class="tag-row-card" data-tag-index="${tagIndex}">
        <div class="tag-row-body">
          <div class="tag-row-fields">
            <label class="tag-name-field"><span class="field-label">${icon("tag")}标签</span><input data-tag-field="name" value="${escapeHtml(tag.name)}" placeholder="例如：A类" /></label>
            <label class="toggle switch-toggle tag-handoff-toggle"><input data-tag-field="handoffEnabled" type="checkbox" ${tag.handoffEnabled ? "checked" : ""} /><span class="switch-slider"></span><span class="switch-label">人工接管</span></label>
            <div class="tag-delete-slot"><button class="danger icon-button" data-remove-tag="${groupIndex}:${tagIndex}" type="button" title="删除标签">${icon("reset")}</button></div>
            <div class="tag-condition-row">
              <div class="expand-field-slot"><label class="wide"><span class="field-label">${icon("check")}达标条件</span><textarea class="expand-on-focus" data-tag-field="condition" rows="2" placeholder="例如：客户明确表示愿意合作或留下联系方式">${escapeHtml(tag.condition)}</textarea></label></div>
              <label class="toggle switch-toggle tag-voice-alert-toggle"><input data-tag-field="voiceAlertEnabled" type="checkbox" ${tag.voiceAlertEnabled ? "checked" : ""} /><span class="switch-slider"></span><span class="switch-label">语音提示</span></label>
            </div>
          </div>
          <section class="activation-editor tag-activation-editor ${task.enabled ? "is-active" : ""}">
            <div class="activation-toolbar"><div class="activation-toolbar-main">
              <label class="toggle switch-toggle activation-toggle"><input data-tag-activation-field="enabled" type="checkbox" ${task.enabled ? "checked" : ""} /><span class="switch-slider"></span><span>${icon("send")}启用触发任务</span></label>
              <label class="toggle activation-toggle activation-polish-toggle"><input data-tag-activation-field="polishByAgent" type="checkbox" ${task.polishByAgent ? "checked" : ""} /><span>${icon("terminal")}Agent 组织语言</span></label>
            </div><button class="secondary icon-button activation-add-button" data-add-tag-activation-message="${groupIndex}:${tagIndex}" type="button" title="新增话术">${icon("plus")}</button></div>
            <div class="activation-messages">${messages.map((message, messageIndex) => `
              <div class="activation-message-card">
                <textarea data-tag-activation-message-index="${messageIndex}" data-tag-activation-message-content rows="2" placeholder="贴上这个标签后要提醒客户的话术">${escapeHtml(message.content)}</textarea>
                <div class="activation-message-actions">
                  <label class="activation-message-control" title="间隔（分钟）">${icon("clock")}<input data-tag-activation-message-index="${messageIndex}" data-tag-activation-message-interval type="number" min="0" value="${message.intervalMinutes}" /><span class="activation-message-unit">分钟</span></label>
                  <label class="activation-message-control" title="发送次数">${icon("refresh")}<input data-tag-activation-message-index="${messageIndex}" data-tag-activation-message-max-times type="number" min="1" value="${message.maxTimes}" /><span class="activation-message-unit">次</span></label>
                  <button class="danger icon-button activation-remove-button" data-remove-tag-activation-message="${groupIndex}:${tagIndex}:${messageIndex}" type="button" title="删除触发话术">${icon("reset")}</button>
                </div>
              </div>`).join("")}</div>
          </section>
        </div>
      </article>`;
  }

  function renderGroups() {
    if (!schema.groups.length) return `<div class="empty-state">暂无标签组。可以先新增一个标签组，例如“意向等级”。</div>`;
    return schema.groups.map((group, groupIndex) => {
      const key = group.id || `group_${groupIndex + 1}`;
      const isCollapsed = collapsed.has(key);
      return `
        <article class="tag-group-card ${isCollapsed ? "is-collapsed" : ""}" data-tag-group-index="${groupIndex}" data-tag-group-collapse-key="${escapeHtml(key)}">
          <div class="tag-group-head">
            <label class="toggle switch-toggle tag-group-enabled-toggle"><input data-tag-group-field="enabled" type="checkbox" ${group.enabled ? "checked" : ""} /><span class="switch-slider"></span><span class="switch-label">启用</span></label>
            <label class="tag-name-field"><span class="field-label">${icon("tag")}标签组</span><input data-tag-group-field="name" value="${escapeHtml(group.name)}" placeholder="例如：意向等级" /></label>
            <label class="toggle"><input data-tag-group-field="exclusive" type="checkbox" ${group.exclusive ? "checked" : ""} />组内互斥</label>
            <label class="toggle"><input data-tag-group-field="oneWay" type="checkbox" ${group.oneWay ? "checked" : ""} />单向变更</label>
            <div class="tag-card-actions"><button class="secondary icon-button" data-add-tag="${groupIndex}" type="button" title="新增标签">${icon("plus")}</button><button class="danger icon-button" data-remove-tag-group="${groupIndex}" type="button" title="删除标签组">${icon("reset")}</button><button class="collapse-button" data-toggle-tag-group="${groupIndex}" type="button" aria-expanded="${!isCollapsed}"><svg class="icon"><use href="#icon-chevron"></use></svg></button></div>
          </div>
          <div class="tag-group-body"><div class="tag-group-body-inner"><div class="tag-row-list">${group.tags.length ? group.tags.map((tag, tagIndex) => renderTag(group, groupIndex, tag, tagIndex)).join("") : `<div class="empty-state">这个标签组还没有标签。</div>`}</div></div></div>
        </article>`;
    }).join("");
  }

  function render() {
    schema = normalize(schema);
    list.innerHTML = `${renderDateTag()}${renderGroups()}`;
  }

  function locate(input) {
    const groupIndex = Number(input.closest("[data-tag-group-index]")?.dataset.tagGroupIndex);
    const tagIndex = Number(input.closest("[data-tag-index]")?.dataset.tagIndex);
    return { groupIndex, tagIndex, group: schema.groups[groupIndex], tag: schema.groups[groupIndex]?.tags[tagIndex] };
  }

  list.addEventListener("input", (event) => {
    const input = event.target;
    if (input.id === "dateTagCutoffTime") schema.dateTag.cutoffTime = input.value || "00:00";
    const { group, tag } = locate(input);
    if (input.dataset.tagGroupField && group) group[input.dataset.tagGroupField] = input.type === "checkbox" ? input.checked : input.value;
    if (input.dataset.tagField && tag) tag[input.dataset.tagField] = input.type === "checkbox" ? input.checked : input.value;
    if (input.dataset.tagActivationField && tag) {
      tag.activation = activation(tag.activation);
      tag.activation[input.dataset.tagActivationField] = input.checked;
      input.closest(".activation-editor")?.classList.toggle("is-active", tag.activation.enabled);
    }
    if (input.dataset.tagActivationMessageIndex !== undefined && tag) {
      tag.activation = activation(tag.activation);
      const index = Number(input.dataset.tagActivationMessageIndex);
      tag.activation.messages[index] ||= activationMessage();
      if (input.dataset.tagActivationMessageInterval !== undefined) tag.activation.messages[index].intervalMinutes = Math.max(0, Number(input.value) || 0);
      else if (input.dataset.tagActivationMessageMaxTimes !== undefined) tag.activation.messages[index].maxTimes = Math.max(1, Number(input.value) || 1);
      else tag.activation.messages[index].content = input.value;
    }
  });

  list.addEventListener("change", (event) => {
    const input = event.target;
    if (input.dataset.tagField === "handoffEnabled" && input.checked && !window.confirm("开启后，一旦标签命中会自动进入人工接管，AI 将不再托管该会话。确认开启？")) {
      input.checked = false;
      const { tag } = locate(input);
      if (tag) tag.handoffEnabled = false;
    }
  });

  list.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.toggleTagGroup !== undefined) {
      const index = Number(button.dataset.toggleTagGroup);
      const key = schema.groups[index]?.id;
      if (collapsed.has(key)) { collapsed.clear(); schema.groups.forEach((group) => collapsed.add(group.id)); collapsed.delete(key); } else collapsed.add(key);
      render();
    }
    if (button.dataset.addTag !== undefined) {
      const group = schema.groups[Number(button.dataset.addTag)];
      const index = group.tags.length + 1;
      group.tags.push({ id: nextId("tag", group.tags.map((tag) => tag.id), index), name: `标签 ${index}`, condition: "", evidenceMode: "customer", enabled: true, voiceAlertEnabled: false, handoffEnabled: false, activation: { enabled: false, polishByAgent: true, messages: [activationMessage()] } });
      collapsed.delete(group.id); render();
    }
    if (button.dataset.removeTagGroup !== undefined) { schema.groups.splice(Number(button.dataset.removeTagGroup), 1); render(); }
    if (button.dataset.removeTag !== undefined) { const [groupIndex, tagIndex] = button.dataset.removeTag.split(":").map(Number); schema.groups[groupIndex].tags.splice(tagIndex, 1); render(); }
    if (button.dataset.addTagActivationMessage !== undefined) { const [groupIndex, tagIndex] = button.dataset.addTagActivationMessage.split(":").map(Number); const tag = schema.groups[groupIndex].tags[tagIndex]; tag.activation = activation(tag.activation); tag.activation.messages.push(activationMessage()); render(); }
    if (button.dataset.removeTagActivationMessage !== undefined) { const [groupIndex, tagIndex, messageIndex] = button.dataset.removeTagActivationMessage.split(":").map(Number); schema.groups[groupIndex].tags[tagIndex].activation.messages.splice(messageIndex, 1); render(); }
  });

  document.querySelector("#addTagGroupButton").addEventListener("click", () => {
    const index = schema.groups.length + 1;
    const id = nextId("group", schema.groups.map((group) => group.id), index);
    schema.groups.push({ id, name: `标签组 ${index}`, enabled: true, exclusive: true, oneWay: false, tags: [] });
    schema.groups.forEach((group) => collapsed.add(group.id)); collapsed.delete(id); render();
  });

  document.querySelector("#saveTagsButton").addEventListener("click", async () => {
    const data = await api(`/api/tag-schemas/${encodeURIComponent(getAccountId())}`, { method: "PUT", body: { schema } });
    schema = normalize(data.schema); render(); onChanged(schema); toast("标签配置已保存");
  });
  document.querySelector("#exportTagsButton").addEventListener("click", () => download("customer-tags.json", schema));
  document.querySelector("#importTagsButton").addEventListener("click", () => document.querySelector("#importTagsFile").click());
  document.querySelector("#importTagsFile").addEventListener("change", async (event) => {
    try { schema = normalize(JSON.parse(await event.target.files[0].text())); schema.groups.forEach((group) => collapsed.add(group.id)); render(); toast("标签 JSON 已导入，保存后生效"); } catch { toast("标签配置 JSON 格式不正确", true); }
    event.target.value = "";
  });

  function download(name, value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
  }

  return {
    async load() {
      const data = await api(`/api/tag-schemas/${encodeURIComponent(getAccountId())}`);
      schema = normalize(data.schema); collapsed.clear(); schema.groups.forEach((group) => collapsed.add(group.id)); render(); onChanged(schema); return schema;
    },
    render,
    getSchema: () => schema
  };
}
