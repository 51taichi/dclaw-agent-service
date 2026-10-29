import { randomUUID } from "node:crypto";
import { validateFlowDecision } from "../flow-machine.js";
import { normalizeTagDecision } from "../tags.js";
import { completeTagDecisionFromEvaluation, normalizeTagEvaluation, validateTagAuditContract } from "../tag-audit.js";

export class AgentGateway {
  constructor({ timeoutMs = 90_000, fetchImpl = globalThis.fetch } = {}) {
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async reply({ account, conversation, inboundMessage, history, flowContext = null, tagContext = null }) {
    if (!account.agentApiUrl || !account.agentApiKey) {
      return {
        reply: "您的消息已收到，我们会尽快为您处理。",
        attachments: [],
        sources: [],
        flowDecision: flowContext ? { currentNodeId: flowContext.currentNode.id, nodeCompleted: false, nextNodeId: flowContext.currentNode.id, collectedDataPatch: {}, confidence: null, reason: "Agent 未配置，保留当前节点" } : null,
        tagEvaluation: [],
        tagDecision: { add: [], remove: [] },
        attentionAlert: null,
        handoff: false,
        source: "unconfigured-fallback"
      };
    }

    const idempotencyKey = `agent:${account.id}:${inboundMessage.id}`;
    const endpoint = resolveAgentEndpoint(account.agentApiUrl, account.agentId);
    const baseMessage = buildAgentMessage({ account, conversation, inboundMessage, history, flowContext, tagContext });
    const request = {
      external_user_id: `${account.provider}:${account.id}:${conversation.externalUserId}`,
      external_session_id: `${account.provider}:${account.id}:${conversation.externalConversationId}`,
      message: baseMessage,
      stream: true,
      metadata: {
        source: "dclaw-agent-service",
        channel: account.provider,
        account_id: account.id,
        deployment_id: account.deploymentId || null,
        agent_id: account.agentId || null
      }
    };
    let validationError = null;
    let previousRaw = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      request.message = attempt === 1 ? baseMessage : buildRepairMessage(baseMessage, previousRaw, validationError);
      const response = await this.fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.agentApiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
          "Idempotency-Key": attempt === 1 ? idempotencyKey : `${idempotencyKey}:repair:${attempt}`
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 2000);
        const error = new Error(`Agent Gateway request failed (${response.status}): ${body}`);
        error.status = 502;
        throw error;
      }
      const contentType = response.headers.get("content-type") || "";
      previousRaw = contentType.includes("text/event-stream") ? await readSse(response) : await response.text();
      try {
        return parseAgentResponse(previousRaw, { flowContext, tagContext, inboundMessage, history });
      } catch (error) {
        validationError = error;
        if (attempt === 3) throw error;
      }
    }
    throw validationError;
  }

  async polishActivation({ account, conversation, content }) {
    if (!account.agentApiUrl || !account.agentApiKey) return content;
    const response = await this.fetch(resolveAgentEndpoint(account.agentApiUrl, account.agentId), {
      method: "POST",
      headers: { Authorization: `Bearer ${account.agentApiKey}`, "Content-Type": "application/json", Accept: "text/event-stream, application/json" },
      body: JSON.stringify({
        external_user_id: `${account.provider}:${account.id}:${conversation.externalUserId}`,
        external_session_id: `${account.provider}:${account.id}:${conversation.externalConversationId}`,
        message: `请将下面的客户激活话术结合当前会话语气自然改写。只输出最终发送文本，不要解释，不要输出 JSON。\n\n${content}`,
        stream: true
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`Agent activation polish failed (${response.status})`);
    const raw = (response.headers.get("content-type") || "").includes("text/event-stream") ? await readSse(response) : await response.text();
    const polished = String(raw || "").trim();
    return polished || content;
  }
}

export function resolveAgentEndpoint(apiUrl, agentId = "") {
  let endpoint;
  try {
    endpoint = new URL(String(apiUrl || "").trim());
  } catch {
    throw new TypeError("Agent OpenAPI URL must be a valid HTTP or HTTPS URL");
  }
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new TypeError("Agent OpenAPI URL must use HTTP or HTTPS");
  }

  const path = endpoint.pathname.replace(/\/+$/, "") || "/";
  const isDclawMessageEndpoint = /\/api\/open\/v1\/targets\/[^/]+\/messages$/i.test(path);
  const isDclawBase = path === "/" || /\/api\/open\/v1$/i.test(path);
  if (!isDclawMessageEndpoint && isDclawBase) {
    const publicId = String(agentId || "").trim();
    if (!publicId) throw new TypeError("Agent Public ID is required when using a DClaw Base URL");
    const prefix = path === "/" ? "/api/open/v1" : path;
    endpoint.pathname = `${prefix}/targets/${encodeURIComponent(publicId)}/messages`;
    endpoint.search = "";
    endpoint.hash = "";
  } else {
    endpoint.pathname = path;
  }
  return endpoint.toString();
}

function buildRepairMessage(baseMessage, previousRaw, error) {
  return [
    baseMessage,
    "上一版输出未通过服务端契约校验。请重新输出一个完整 JSON 对象，不要解释，不要省略任何必需字段。",
    `校验错误：${String(error?.message || error).slice(0, 4000)}`,
    `上一版输出：${String(previousRaw || "").slice(0, 12_000)}`
  ].join("\n");
}

function buildAgentMessage({ account, conversation, inboundMessage, history, flowContext, tagContext }) {
  const responseContract = {
    reply: "给客户的回复；仅当当前末节点允许静默且确实无需回复时可为空字符串",
    flowDecision: flowContext ? { currentNodeId: flowContext.currentNode.id, nodeCompleted: false, nextNodeId: flowContext.currentNode.id, confidence: 0, collectedDataPatch: {}, reason: "判断理由" } : null,
    tagEvaluation: tagContext ? "逐一评价 tagContext.groups 中每个标签，字段为 groupId/tagId/matched/reason/evidenceMessageId/evidenceText" : [],
    tagDecision: tagContext ? { add: [], remove: [] } : { add: [], remove: [] },
    attentionAlert: null,
    handoff: false
  };
  const evidenceCandidates = history
    .filter((item) => item.direction === "inbound")
    .map((item) => ({ id: String(item.id), text: item.content }));
  const payload = {
    channel: { provider: account.provider, accountId: account.id },
    tenantContext: {
      workspace: account.workspace ? {
        id: account.workspace.id,
        name: account.workspace.name,
        companyContext: account.workspace.companyContext || {}
      } : null,
      person: account.person ? {
        id: account.person.id,
        name: account.person.name,
        title: account.person.title,
        persona: account.person.persona || {},
        profile: account.person.profile || {}
      } : null,
      companyAssistant: account.assistantProfile ? {
        name: account.assistantProfile.assistantName || "公司助手",
        brand: account.assistantProfile.assistantBrandText || "",
        greeting: account.assistantProfile.assistantGreeting || "",
        configuredTopics: account.assistantProfile.assistantTopics || []
      } : null,
      deploymentId: account.deploymentId || null,
      agentBindingScope: account.agentBinding?.inheritedFrom || account.agentBinding?.scopeType || "unconfigured"
    },
    worktoolMessage: {
      channel: account.provider,
      eventType: "inbound_message",
      botId: account.id,
      agentId: account.agentId,
      conversationId: `${account.provider}:${account.id}:${conversation.externalConversationId}`,
      sessionId: `${account.provider}:${account.id}:${conversation.externalConversationId}`,
      messageId: String(inboundMessage.id),
      message: inboundMessage.content,
      rawMessage: inboundMessage.content,
      roomType: 2,
      groupName: "",
      userId: conversation.externalUserId,
      metadata: {
        receivedName: conversation.displayName,
        messageType: inboundMessage.messageType,
        inboundAttachments: inboundMessage.metadata?.attachments || [],
        channelMetadata: inboundMessage.metadata || {}
      }
    },
    conversation: { id: conversation.id, externalUserId: conversation.externalUserId, displayName: conversation.displayName, mode: conversation.mode, currentState: conversation.state },
    currentMessage: { id: inboundMessage.id, type: inboundMessage.messageType, text: inboundMessage.content, metadata: inboundMessage.metadata },
    recentHistory: history,
    conversationTurns: history,
    customerEvidenceCandidates: evidenceCandidates,
    tagEvidenceCandidates: evidenceCandidates,
    responseContract
  };
  if (flowContext) payload.flow = flowContext;
  if (tagContext) payload.tagRules = tagContext;
  return [
    `你收到的是 ${account.provider} 渠道经 DClaw Agent Service 转发的标准 JSON 业务包。请只输出 JSON 对象，不要使用 Markdown 代码块。`,
    "tenantContext 由服务端生成。必须遵循其中的公司边界与身份配置：person 存在时以当前人物身份回答；companyAssistant 存在时以公司公共助手身份回答。不得把其他工作区、人物或渠道的数据混入回复。",
    "必须严格遵守 responseContract。输入含 flow 时必须输出 flowDecision，currentNodeId 必须是 flow.currentNode.id；未完成时 nextNodeId 保持当前节点，完成时只能进入 allowedNextNodeId。collectedDataPatch 只能填写当前节点配置的字段。",
    "输入含 tagRules 时必须逐一输出 tagEvaluation；客户证据必须引用 tagEvidenceCandidates 中的 id，evidenceText 必须逐字一致。",
    "attachments 使用 type、url、name、title 字段；富链接卡片使用 type=card，并可增加 subtitle、pictureUrl。需要客户选择时使用 type=single-choice 或 multi-choice，并提供 id、title、options（每项含 label、value、description）和 submitLabel；选择结果只在客户点击提交后返回。attentionAlert 仅在确实需要人工关注时设置 required=true，否则必须设置 required=false。",
    JSON.stringify(payload)
  ].join("\n");
}

async function readSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let deltaText = "";
  let completedText = "";
  let finalText = "";
  const consumeLine = (line) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const parsed = JSON.parse(data);
      const streamError = parsed?.error || (["failed", "cancelled"].includes(parsed?.status) ? parsed : null);
      if (streamError) {
        const message = typeof streamError === "string"
          ? streamError
          : streamError.message || streamError.detail || streamError.code || JSON.stringify(streamError);
        throw new Error(`Agent stream failed: ${message}`);
      }
      if (parsed?.object === "content" && typeof parsed.text === "string") {
        if (parsed.delta === true) deltaText += parsed.text;
        else if (parsed.status === "completed") completedText = parsed.text;
        return;
      }
      if (parsed?.object === "response" && parsed.status === "completed") {
        const outputText = extractOutputText(parsed.output);
        if (outputText) finalText = outputText;
        return;
      }
      deltaText += extractText(parsed);
    } catch (error) {
      if (error?.message?.startsWith("Agent stream failed:")) throw error;
      deltaText += data;
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) consumeLine(line);
    if (done) {
      if (buffer) consumeLine(buffer);
      break;
    }
  }
  return String(finalText || completedText || deltaText).trim();
}

function extractText(value) {
  if (typeof value === "string") return value;
  return String(value?.choices?.[0]?.delta?.content ?? value?.delta?.content ?? value?.delta ?? value?.text ?? value?.reply ?? value?.content ?? value?.message?.content ?? value?.data?.text ?? "");
}

function extractOutputText(output) {
  if (!Array.isArray(output)) return "";
  for (const item of output) {
    if (!Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (typeof content?.text === "string" && content.text.trim()) return content.text;
    }
  }
  return "";
}

export function parseAgentResponse(raw, { flowContext = null, tagContext = null, inboundMessage = null, history = [] } = {}) {
  let value = raw;
  if (typeof raw === "string") {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { value = JSON.parse(cleaned); } catch { value = { reply: cleaned }; }
  }
  if (value?.data && typeof value.data === "object") value = value.data;
  const reply = String(value?.reply ?? value?.message ?? value?.content ?? "").trim();
  const mayBeSilent = Boolean(flowContext?.terminal && flowContext?.currentNode?.silentReply?.enabled);
  if (!reply && !mayBeSilent) throw new Error("Agent response does not contain a reply");
  if (reply.length > 20_000) throw new Error("Agent reply exceeds 20000 characters");
  const rawAlert = value?.attentionAlert || value?.attention;
  const evidenceCandidates = history.filter((item) => item.direction === "inbound").map((item) => ({ id: String(item.id), text: item.content }));
  if (inboundMessage && !evidenceCandidates.some((item) => item.id === String(inboundMessage.id))) evidenceCandidates.push({ id: String(inboundMessage.id), text: inboundMessage.content });
  const attentionAlert = normalizeAttentionAlert(rawAlert, evidenceCandidates);
  const flowDecision = flowContext ? validateFlowDecision(value?.flowDecision || value?.stateUpdate, { flowContext }) : null;
  const tagEvaluation = normalizeTagEvaluation(value?.tagEvaluation);
  const tagDecision = tagContext?.groups?.length
    ? completeTagDecisionFromEvaluation({ evaluation: tagEvaluation, decision: value?.tagDecision || value?.tags, tagContext })
    : normalizeTagDecision(value?.tagDecision || value?.tags);
  if (tagContext?.groups?.length) {
    const audit = validateTagAuditContract({ evaluation: tagEvaluation, decision: tagDecision, tagContext, evidenceCandidates });
    if (audit.errors.length) throw new TypeError(`Agent 标签决策不符合契约: ${audit.errors.map((item) => `${item.path}: ${item.message}`).join("; ")}`);
  }
  return {
    reply,
    attachments: normalizeAttachments(value?.attachments || value?.resources || value?.files),
    sources: normalizeSources(value?.sources || value?.references || value?.evidence),
    flowDecision,
    tagEvaluation,
    tagDecision,
    attentionAlert,
    handoff: value?.handoff === true,
    source: "agent",
    responseId: value?.response_id || randomUUID()
  };
}

function normalizeAttachments(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const type = String(item.type || item.fileType || item.kind || "link").trim().toLowerCase();
      if (type === "single-choice" || type === "multi-choice") {
        const options = (Array.isArray(item.options) ? item.options : []).slice(0, 12).map((option) => {
          const source = typeof option === "string" ? { label: option, value: option } : option || {};
          const label = String(source.label || source.title || source.value || "").trim().slice(0, 120);
          return {
            label,
            value: String(source.value || label).trim().slice(0, 120),
            description: String(source.description || source.subtitle || "").trim().slice(0, 240)
          };
        }).filter((option) => option.label);
        return {
          type,
          id: String(item.id || item.name || "choice").trim().slice(0, 120),
          title: String(item.title || item.name || "请选择").trim().slice(0, 160),
          subtitle: String(item.subtitle || item.description || "").trim().slice(0, 240),
          options,
          submitLabel: String(item.submitLabel || "提交回答").trim().slice(0, 40)
        };
      }
      const attachment = {
        type,
        url: String(item.url || item.fileUrl || item.href || "").trim()
      };
      const name = String(item.name || item.objectName || item.filename || item.fileName || "").trim();
      const title = String(item.title || item.label || "").trim();
      const subtitle = String(item.subtitle || item.description || "").trim();
      const pictureUrl = String(item.pictureUrl || item.picture_url || item.imageUrl || "").trim();
      if (name) attachment.name = name;
      if (title) attachment.title = title;
      if (subtitle) attachment.subtitle = subtitle;
      if (/^https?:\/\//i.test(pictureUrl)) attachment.pictureUrl = pictureUrl;
      return attachment;
    })
    .filter((item) => item.type === "single-choice" || item.type === "multi-choice" ? item.options.length : /^https?:\/\//i.test(item.url));
}

function normalizeSources(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.filter((item) => item && typeof item === "object").map((item) => ({
    type: String(item.type || item.kind || "").trim(),
    name: String(item.name || item.title || "").trim(),
    reason: String(item.reason || item.usage || item.description || "").trim()
  })).filter((item) => item.type && item.name);
}

function normalizeAttentionAlert(value, evidenceCandidates = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.hasOwn(value, "required") && value.required !== true) return null;
  const reason = String(value.reason || value.detail || "").trim();
  const title = String(value.title || "需要人工关注").trim().slice(0, 160);
  if (!reason && value.required === true) throw new TypeError("attentionAlert.reason is required when attentionAlert.required=true");
  if (value.required === true) {
    const evidenceMessageId = String(value.evidenceMessageId || "").trim();
    const evidenceText = String(value.evidenceText || "").trim();
    const candidate = evidenceCandidates.find((item) => item.id === evidenceMessageId);
    if (!candidate) throw new TypeError("attentionAlert.evidenceMessageId is not in customerEvidenceCandidates");
    if (candidate.text !== evidenceText) throw new TypeError("attentionAlert.evidenceText must exactly match the selected customer message");
    return { title, detail: reason.slice(0, 1000), evidenceMessageId, evidenceText };
  }
  return { title, detail: reason.slice(0, 1000) };
}
