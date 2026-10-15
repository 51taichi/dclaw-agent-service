import { randomUUID } from "node:crypto";
import { validateFlowDecision } from "../flow-machine.js";
import { normalizeTagDecision } from "../tags.js";
import { normalizeTagEvaluation, validateTagAuditContract } from "../tag-audit.js";

export class AgentGateway {
  constructor({ timeoutMs = 90_000, fetchImpl = globalThis.fetch } = {}) {
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async reply({ account, conversation, inboundMessage, history, flowContext = null, tagContext = null }) {
    if (!account.agentApiUrl || !account.agentApiKey) {
      return {
        reply: "您的消息已收到，我们会尽快为您处理。",
        flowDecision: flowContext ? { nodeCompleted: false, nextNodeId: "", collectedDataPatch: {}, reason: "Agent 未配置，保留当前节点" } : null,
        tagEvaluation: [],
        tagDecision: { add: [], remove: [] },
        attentionAlert: null,
        handoff: false,
        source: "unconfigured-fallback"
      };
    }

    const idempotencyKey = `agent:${account.id}:${inboundMessage.id}`;
    const request = {
      external_user_id: `${account.provider}:${account.id}:${conversation.externalUserId}`,
      external_session_id: `${account.provider}:${account.id}:${conversation.externalConversationId}`,
      message: buildAgentMessage({ account, conversation, inboundMessage, history, flowContext, tagContext }),
      stream: true
    };
    const response = await this.fetch(account.agentApiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.agentApiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json",
        "Idempotency-Key": idempotencyKey
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
    const raw = contentType.includes("text/event-stream") ? await readSse(response) : await response.text();
    return parseAgentResponse(raw, { flowContext, tagContext, inboundMessage, history });
  }

  async polishActivation({ account, conversation, content }) {
    if (!account.agentApiUrl || !account.agentApiKey) return content;
    const response = await this.fetch(account.agentApiUrl, {
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

function buildAgentMessage({ account, conversation, inboundMessage, history, flowContext, tagContext }) {
  const responseContract = {
    reply: "给客户的回复；仅当当前末节点允许静默且确实无需回复时可为空字符串",
    flowDecision: flowContext ? { nodeCompleted: false, nextNodeId: "", collectedDataPatch: {}, reason: "判断理由" } : null,
    tagEvaluation: tagContext ? "逐一评价 tagContext.groups 中每个标签，字段为 groupId/tagId/matched/reason/evidenceMessageId/evidenceText" : [],
    tagDecision: tagContext ? { add: [], remove: [] } : { add: [], remove: [] },
    attentionAlert: null,
    handoff: false
  };
  return [
    "你正在通过 DClaw Agent Service 处理一条客户消息。请只输出 JSON 对象，不要使用 Markdown 代码块。",
    "必须严格遵守 responseContract。flowDecision 只能按当前节点配置跳转，collectedDataPatch 只能填写当前节点配置的字段。",
    "标签启用时必须逐一输出 tagEvaluation；客户证据必须引用 tagEvidenceCandidates 中的 id，evidenceText 必须逐字一致。",
    "仅在确实需要人工介入时创建 attentionAlert 或 handoff。",
    JSON.stringify({
      channel: { provider: account.provider, accountId: account.id },
      conversation: { id: conversation.id, externalUserId: conversation.externalUserId, displayName: conversation.displayName, mode: conversation.mode, currentState: conversation.state },
      currentMessage: { id: inboundMessage.id, type: inboundMessage.messageType, text: inboundMessage.content, metadata: inboundMessage.metadata },
      recentHistory: history,
      flowContext,
      tagContext,
      tagEvidenceCandidates: history.filter((item) => item.direction === "inbound").map((item) => ({ id: String(item.id), text: item.content })),
      responseContract
    })
  ].join("\n");
}

async function readSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let collected = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        collected += extractText(parsed);
      } catch {
        collected += data;
      }
    }
    if (done) break;
  }
  return collected.trim();
}

function extractText(value) {
  if (typeof value === "string") return value;
  return String(value?.delta?.content ?? value?.delta ?? value?.text ?? value?.reply ?? value?.content ?? value?.message?.content ?? value?.data?.text ?? "");
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
  const attentionAlert = rawAlert && typeof rawAlert === "object"
    ? { title: String(rawAlert.title || "需要人工关注").slice(0, 160), detail: String(rawAlert.detail || "").slice(0, 1000) }
    : null;
  const flowDecision = flowContext ? validateFlowDecision(value?.flowDecision || value?.stateUpdate, { flowContext }) : null;
  const tagEvaluation = normalizeTagEvaluation(value?.tagEvaluation);
  const tagDecision = normalizeTagDecision(value?.tagDecision || value?.tags);
  if (tagContext?.groups?.length) {
    const evidenceCandidates = history.filter((item) => item.direction === "inbound").map((item) => ({ id: String(item.id), text: item.content }));
    if (inboundMessage && !evidenceCandidates.some((item) => item.id === String(inboundMessage.id))) evidenceCandidates.push({ id: String(inboundMessage.id), text: inboundMessage.content });
    const audit = validateTagAuditContract({ evaluation: tagEvaluation, decision: tagDecision, tagContext, evidenceCandidates });
    if (audit.errors.length) throw new TypeError(`Agent 标签决策不符合契约: ${audit.errors.map((item) => `${item.path}: ${item.message}`).join("; ")}`);
  }
  return {
    reply,
    flowDecision,
    tagEvaluation,
    tagDecision,
    attentionAlert,
    handoff: value?.handoff === true,
    source: "agent",
    responseId: value?.response_id || randomUUID()
  };
}
