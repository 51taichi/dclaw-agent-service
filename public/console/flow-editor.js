export function createFlowEditor({ api, toast, icon, escapeHtml, getAccountId, onChanged = () => {} }) {
  const form = document.querySelector("#flowMachineForm");
  const list = document.querySelector("#flowNodeList");
  const collapsed = new Set();
  let machine = null;
  let nodes = [];
  let draggedIndex = null;

  const fields = [
    { field: "goal", label: "节点目标", icon: "terminal", placeholder: "这个阶段要让 AI 完成什么" },
    { field: "completionCriteria", label: "完成条件", icon: "info", placeholder: "什么情况下可以进入下一节点" },
    { field: "collectFields", label: "收集字段", icon: "briefcase", placeholder: "每行一个，例如：手机号", list: true },
    { field: "conversationTips", label: "交流技巧", icon: "users", placeholder: "每行一个，例如：先回应再追问", list: true }
  ];
  const silentInstruction = "当客户消息只是确认、附和、感谢或结束语，没有提出新问题、请求、异议、负面情绪，也没有提供需要继续处理的新信息时，可以静默结束对话。如果消息中同时包含问题、请求、异常反馈或需要继续处理的信息，必须正常回复。";
  const activationMessage = () => ({ content: "", intervalMinutes: 30, maxTimes: 1 });

  function split(value) { return String(value || "").split(/\n|,/).map((item) => item.trim()).filter(Boolean); }
  function join(value) { return Array.isArray(value) ? value.join("\n") : String(value || ""); }
  function activation(value = {}) {
    return { enabled: Boolean(value.enabled), polishByAgent: value.polishByAgent !== false, messages: Array.isArray(value.messages) ? value.messages.map((item) => ({ content: String(item?.content || ""), intervalMinutes: Math.max(0, Number(item?.intervalMinutes) || 0), maxTimes: Math.max(1, Number(item?.maxTimes) || 1) })) : [] };
  }
  function normalizeNode(node = {}, index = 0) {
    return { id: String(node.id || `node_${index + 1}`), name: String(node.name || `节点 ${index + 1}`), goal: String(node.goal || ""), completionCriteria: String(node.completionCriteria || ""), collectFields: Array.isArray(node.collectFields) ? node.collectFields.map(String) : [], conversationTips: Array.isArray(node.conversationTips) ? node.conversationTips.map(String) : [], silentReply: { enabled: Boolean(node.silentReply?.enabled), instruction: String(node.silentReply?.instruction || silentInstruction) }, activation: activation(node.activation), nextNodeId: String(node.nextNodeId || ""), transitions: [] };
  }
  function blankNode() {
    let index = nodes.length + 1;
    const ids = new Set(nodes.map((node) => node.id));
    while (ids.has(`node_${index}`)) index += 1;
    return normalizeNode({ id: `node_${index}`, name: `节点 ${index}`, activation: { messages: [activationMessage()] } }, index - 1);
  }
  function setConfig(config = {}) {
    const sourceNodes = Array.isArray(config.nodes) && config.nodes.length ? config.nodes : [blankNode()];
    nodes = sourceNodes.map(normalizeNode);
    form.flowName.value = config.name || "客服状态机";
    form.flowVersion.value = config.version || "1.0.0";
    form.generalRule.value = config.generalRule || "";
    form.entryNodeId.value = config.entryNodeId || nodes[0].id;
    collapsed.clear(); nodes.forEach((node) => collapsed.add(node.id)); collapsed.delete(nodes[0].id);
    render(); syncJson();
  }
  function buildConfig() {
    return { name: String(form.flowName.value || "客服状态机").trim(), version: String(form.flowVersion.value || "1.0.0").trim(), generalRule: String(form.generalRule.value || "").trim(), entryNodeId: nodes.some((node) => node.id === form.entryNodeId.value) ? form.entryNodeId.value : nodes[0]?.id || "", nodes: nodes.map((node) => ({ ...node, id: node.id.trim(), name: node.name.trim(), goal: node.goal.trim(), completionCriteria: node.completionCriteria.trim(), collectFields: node.collectFields.map((item) => item.trim()).filter(Boolean), conversationTips: node.conversationTips.map((item) => item.trim()).filter(Boolean), activation: { ...activation(node.activation), messages: activation(node.activation).messages.filter((item) => item.content.trim()) } })) };
  }
  function syncJson() { form.config.value = JSON.stringify(buildConfig(), null, 2); }
  function relink() { nodes.forEach((node, index) => { node.nextNodeId = nodes[index + 1]?.id || ""; }); form.entryNodeId.value = nodes[0]?.id || ""; }

  function quickFields(node, index) {
    return `<div class="flow-node-quick-fields">${fields.map((field) => { const value = field.list ? join(node[field.field]) : node[field.field]; return `<button class="flow-node-field-pill ${String(value).trim() ? "is-filled" : "is-empty"}" data-quick-field="${field.field}" data-node-index="${index}" type="button" title="${escapeHtml(`${field.label}：${String(value).replace(/\s+/g, " ") || "未填写"}`)}">${icon(field.icon)}</button>`; }).join("")}</div>`;
  }
  function editorField(node, field) {
    return `<div class="expand-field-slot"><label><span class="field-label">${icon(field.icon)}${field.label}</span><textarea class="expand-on-focus" data-node-field="${field.field}" rows="${field.list ? 3 : 2}" placeholder="${field.placeholder}">${escapeHtml(field.list ? join(node[field.field]) : node[field.field])}</textarea></label></div>`;
  }
  function activationEditor(node, index) {
    const task = activation(node.activation); const messages = task.messages.length ? task.messages : [activationMessage()];
    return `<section class="activation-editor ${task.enabled ? "is-active" : ""}">
      <div class="activation-toolbar"><div class="activation-toolbar-main"><label class="toggle switch-toggle activation-toggle"><input data-node-activation="enabled" type="checkbox" ${task.enabled ? "checked" : ""} /><span class="switch-slider"></span><span>${icon("send")}启用客户激活</span></label><label class="toggle activation-toggle activation-polish-toggle"><input data-node-activation="polishByAgent" type="checkbox" ${task.polishByAgent ? "checked" : ""} /><span>${icon("terminal")}Agent 组织语言</span></label><span class="activation-help-icon" title="例：10 分钟后发第 1 条；填 0 则按 5 秒倒计时。客户回复后自动停止。">${icon("info")}</span></div><button class="secondary icon-button activation-add-button" data-add-activation="${index}" type="button" title="新增话术">${icon("plus")}</button></div>
      <div class="activation-messages">${messages.map((message, messageIndex) => `<div class="activation-message-card"><textarea data-activation-index="${messageIndex}" data-activation-content rows="2" placeholder="激活话术，例如：再提醒您一下，看到后回我一句就行">${escapeHtml(message.content)}</textarea><div class="activation-message-actions"><label class="activation-message-control">${icon("clock")}<input data-activation-index="${messageIndex}" data-activation-interval type="number" min="0" value="${message.intervalMinutes}" /><span class="activation-message-unit">分钟</span></label><label class="activation-message-control">${icon("refresh")}<input data-activation-index="${messageIndex}" data-activation-times type="number" min="1" value="${message.maxTimes}" /><span class="activation-message-unit">次</span></label><button class="danger icon-button activation-remove-button" data-remove-activation="${index}:${messageIndex}" type="button" title="删除激活话术">${icon("reset")}</button></div></div>`).join("")}</div>
    </section>`;
  }
  function silentEditor(node) {
    if (node.nextNodeId) return "";
    return `<section class="activation-editor terminal-silent-reply-editor ${node.silentReply.enabled ? "is-active" : ""}"><div class="activation-toolbar terminal-silent-reply-toolbar"><div class="activation-toolbar-main"><label class="toggle switch-toggle activation-toggle"><input data-silent-field="enabled" type="checkbox" ${node.silentReply.enabled ? "checked" : ""} /><span class="switch-slider"></span><span>${icon("terminal")}允许 AI 静默结束对话</span></label><span class="activation-help-icon" title="仍会调用 Agent 做语义、流程和标签判断；只有 Agent 明确返回空内容时才不发送消息。">${icon("info")}</span></div></div><div class="activation-messages terminal-silent-reply-content"><div class="activation-message-card terminal-silent-reply-card"><label class="terminal-silent-reply-rule"><span>静默判断规则</span><textarea data-silent-field="instruction" rows="3">${escapeHtml(node.silentReply.instruction)}</textarea></label></div></div></section>`;
  }

  function render() {
    const currentEntry = nodes.some((node) => node.id === form.entryNodeId.value) ? form.entryNodeId.value : nodes[0]?.id || "";
    form.entryNodeId.innerHTML = nodes.map((node) => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.name)}</option>`).join(""); form.entryNodeId.value = currentEntry;
    list.innerHTML = nodes.map((node, index) => {
      const isCollapsed = collapsed.has(node.id);
      const options = [`<option value="">不自动跳转</option>`, ...nodes.filter((item) => item.id !== node.id).map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === node.nextNodeId ? "selected" : ""}>${escapeHtml(item.name)}</option>`)].join("");
      return `<article class="flow-node-card ${isCollapsed ? "is-collapsed" : ""}" data-node-index="${index}" data-node-key="${escapeHtml(node.id)}" draggable="false">
        <div class="flow-node-card-head"><button class="flow-node-drag-handle" type="button" title="拖拽调整节点顺序">${icon("grip")}</button><button class="flow-node-title" data-edit-name="${index}" type="button" title="双击编辑节点名称"><span class="flow-node-title-icon">${icon("link")}</span><strong>${escapeHtml(node.name)}</strong></button>${quickFields(node, index)}<div class="flow-node-actions"><label class="flow-node-next-field"><span class="field-label">${icon("link")}完成后进入</span><select data-node-field="nextNodeId">${options}</select></label><button class="danger icon-button" data-remove-node="${index}" type="button" title="删除任务节点">${icon("reset")}</button><button class="collapse-button" data-toggle-node="${index}" type="button" aria-expanded="${!isCollapsed}"><svg class="icon"><use href="#icon-chevron"></use></svg></button></div></div>
        <div class="flow-node-card-body"><div class="flow-node-card-body-inner"><div class="flow-node-grid">${fields.map((field) => editorField(node, field)).join("")}</div>${activationEditor(node, index)}${silentEditor(node)}</div></div>
      </article>`;
    }).join("");
  }

  function nodeFor(element) { return nodes[Number(element.closest("[data-node-index]")?.dataset.nodeIndex)]; }
  list.addEventListener("input", (event) => {
    const input = event.target; const node = nodeFor(input); if (!node) return;
    if (input.dataset.nodeField) node[input.dataset.nodeField] = ["collectFields", "conversationTips"].includes(input.dataset.nodeField) ? split(input.value) : input.value;
    if (input.dataset.nodeActivation) { node.activation = activation(node.activation); node.activation[input.dataset.nodeActivation] = input.checked; input.closest(".activation-editor")?.classList.toggle("is-active", node.activation.enabled); }
    if (input.dataset.activationIndex !== undefined) { node.activation = activation(node.activation); const index = Number(input.dataset.activationIndex); node.activation.messages[index] ||= activationMessage(); if (input.dataset.activationInterval !== undefined) node.activation.messages[index].intervalMinutes = Math.max(0, Number(input.value) || 0); else if (input.dataset.activationTimes !== undefined) node.activation.messages[index].maxTimes = Math.max(1, Number(input.value) || 1); else node.activation.messages[index].content = input.value; }
    if (input.dataset.silentField) { node.silentReply[input.dataset.silentField] = input.type === "checkbox" ? input.checked : input.value; input.closest(".activation-editor")?.classList.toggle("is-active", node.silentReply.enabled); }
    syncJson();
  });
  list.addEventListener("change", (event) => { if (["name", "id", "nextNodeId"].includes(event.target.dataset.nodeField)) { const oldKeys = [...collapsed]; collapsed.clear(); oldKeys.forEach((key) => collapsed.add(key)); render(); syncJson(); } });
  list.addEventListener("dblclick", (event) => { const button = event.target.closest("[data-edit-name],[data-quick-field]"); if (button) openQuickEditor(Number(button.dataset.nodeIndex ?? button.dataset.editName), button.dataset.quickField || "name"); });
  list.addEventListener("click", (event) => {
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.toggleNode !== undefined) { const node = nodes[Number(button.dataset.toggleNode)]; if (collapsed.has(node.id)) { collapsed.clear(); nodes.forEach((item) => collapsed.add(item.id)); collapsed.delete(node.id); } else collapsed.add(node.id); render(); }
    if (button.dataset.removeNode !== undefined) { if (nodes.length === 1) return toast("至少保留一个节点", true); nodes.splice(Number(button.dataset.removeNode), 1); relink(); render(); syncJson(); }
    if (button.dataset.addActivation !== undefined) { const node = nodes[Number(button.dataset.addActivation)]; node.activation = activation(node.activation); node.activation.messages.push(activationMessage()); render(); }
    if (button.dataset.removeActivation !== undefined) { const [nodeIndex, messageIndex] = button.dataset.removeActivation.split(":").map(Number); nodes[nodeIndex].activation.messages.splice(messageIndex, 1); render(); }
  });
  list.addEventListener("pointerdown", (event) => { const handle = event.target.closest(".flow-node-drag-handle"); const card = event.target.closest("[data-node-index]"); if (card) card.draggable = Boolean(handle); });
  list.addEventListener("dragstart", (event) => { const card = event.target.closest("[data-node-index]"); if (!card || card.draggable !== true) return event.preventDefault(); draggedIndex = Number(card.dataset.nodeIndex); card.classList.add("is-drag-placeholder"); });
  list.addEventListener("dragover", (event) => event.preventDefault());
  list.addEventListener("drop", (event) => { event.preventDefault(); const target = event.target.closest("[data-node-index]"); if (!target || draggedIndex === null) return; const targetIndex = Number(target.dataset.nodeIndex); [nodes[draggedIndex], nodes[targetIndex]] = [nodes[targetIndex], nodes[draggedIndex]]; draggedIndex = null; relink(); render(); syncJson(); });
  list.addEventListener("dragend", (event) => { const card = event.target.closest("[data-node-index]"); if (card) card.draggable = false; draggedIndex = null; render(); });

  function openQuickEditor(index, fieldName) {
    const node = nodes[index]; const definition = fieldName === "name" ? { field: "name", label: "节点名称" } : fields.find((item) => item.field === fieldName); if (!node || !definition) return;
    let dialog = document.querySelector("#flowNodeQuickEditor");
    if (!dialog) { dialog = document.createElement("div"); dialog.id = "flowNodeQuickEditor"; dialog.className = "modal-backdrop"; dialog.innerHTML = `<div class="confirm-dialog flow-node-quick-dialog" role="dialog"><div class="confirm-icon">${icon("edit")}</div><div class="confirm-copy"><strong data-quick-title></strong><div class="flow-node-quick-control"></div></div><div class="confirm-actions"><button class="secondary" data-quick-cancel type="button">取消</button><button class="primary" data-quick-save type="button">${icon("save")}保存</button></div></div>`; document.body.append(dialog); dialog.addEventListener("click", (event) => { if (event.target === dialog || event.target.closest("[data-quick-cancel]")) dialog.hidden = true; }); }
    dialog.dataset.index = String(index); dialog.dataset.field = definition.field; dialog.querySelector("[data-quick-title]").textContent = `编辑${definition.label}`; const value = definition.list ? join(node[definition.field]) : node[definition.field]; dialog.querySelector(".flow-node-quick-control").innerHTML = definition.field === "name" ? `<label><span class="field-label">节点名称</span><input data-quick-input value="${escapeHtml(value)}" /></label>` : `<label class="wide"><span class="field-label">${definition.label}</span><textarea data-quick-input rows="5">${escapeHtml(value)}</textarea></label>`; dialog.hidden = false;
    dialog.querySelector("[data-quick-save]").onclick = () => { const item = nodes[Number(dialog.dataset.index)]; const def = dialog.dataset.field === "name" ? { field: "name" } : fields.find((entry) => entry.field === dialog.dataset.field); const value = dialog.querySelector("[data-quick-input]").value; item[def.field] = def.list ? split(value) : value; dialog.hidden = true; render(); syncJson(); };
    requestAnimationFrame(() => dialog.querySelector("[data-quick-input]")?.focus());
  }

  form.addEventListener("submit", async (event) => { event.preventDefault(); const data = await api(`/api/flow-machines/${encodeURIComponent(getAccountId())}`, { method: "PUT", body: { enabled: form.enabled.checked, config: buildConfig() } }); machine = data.machine; setConfig(machine.config); form.enabled.checked = machine.enabled; onChanged(machine); toast("状态机已保存"); });
  form.generalRule.addEventListener("input", syncJson); form.flowName.addEventListener("input", syncJson);
  document.querySelector("#addFlowNodeButton").addEventListener("click", () => { const node = blankNode(); nodes.push(node); collapsed.add(node.id); collapsed.delete(node.id); render(); syncJson(); });
  document.querySelector("#loadDefaultFlowButton").addEventListener("click", async () => { const data = await api(`/api/flow-machines/${encodeURIComponent(getAccountId())}?default=1`); setConfig(data.machine.config); form.enabled.checked = false; toast("模板已载入，确认后请保存"); });
  document.querySelector("#applyFlowJsonButton").addEventListener("click", () => document.querySelector("#importFlowFile").click());
  document.querySelector("#importFlowFile").addEventListener("change", async (event) => { try { setConfig(JSON.parse(await event.target.files[0].text())); toast("状态机配置已导入，保存后生效"); } catch { toast("状态机配置 JSON 格式不正确", true); } event.target.value = ""; });
  document.querySelector("#exportFlowButton").addEventListener("click", () => { const config = buildConfig(); const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `${config.name || "flow-machine"}.json`; link.click(); URL.revokeObjectURL(url); });

  return {
    async load() { const data = await api(`/api/flow-machines/${encodeURIComponent(getAccountId())}`); machine = data.machine; form.enabled.checked = machine.enabled; setConfig(machine.config); onChanged(machine); return machine; },
    render,
    getMachine: () => machine
  };
}
