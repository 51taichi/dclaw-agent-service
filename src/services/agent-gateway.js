import { randomUUID } from "node:crypto";

export class AgentGateway {
  constructor({ timeoutMs = 90_000, fetchImpl = globalThis.fetch } = {}) {
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async reply({ account, conversation, inboundMessage, history, stateMachine }) {
    if (!account.agentApiUrl || !account.agentApiKey) {
      return {
        reply: "您的消息已收到，我们会尽快为您处理。",
        state: conversation.state === "new" ? "engaged" : conversation.state,
        tags: [],
        attention: null,
        source: "unconfigured-fallback"
      };
    }

    const idempotencyKey = `agent:${account.id}:${inboundMessage.id}`;
    const request = {
      external_user_id: `${account.provider}:${account.id}:${conversation.externalUserId}`,
      external_session_id: `${account.provider}:${account.id}:${conversation.externalConversationId}`,
      message: buildAgentMessage({ account, conversation, inboundMessage, history, stateMachine }),
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
    return parseAgentResponse(raw);
  }
}

function buildAgentMessage({ account, conversation, inboundMessage, history, stateMachine }) {
  return [
    "你正在通过 DClaw Agent Service 处理一条客户消息。请只输出 JSON 对象，不要使用 Markdown 代码块。",
    "JSON 格式：{\"reply\":\"给客户的回复\",\"state\":\"状态ID\",\"tags\":[\"标签名\"],\"attention\":null 或 {\"title\":\"提醒标题\",\"detail\":\"说明\"},\"handoff\":false}。",
    "state 只能从 stateMachine.states 中选择；不需要更新时使用当前状态。仅在确实需要人工介入时创建 attention 或 handoff。",
    JSON.stringify({
      channel: { provider: account.provider, accountId: account.id },
      conversation: { id: conversation.id, externalUserId: conversation.externalUserId, displayName: conversation.displayName, mode: conversation.mode, currentState: conversation.state },
      currentMessage: { id: inboundMessage.id, type: inboundMessage.messageType, text: inboundMessage.content, metadata: inboundMessage.metadata },
      recentHistory: history,
      stateMachine
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

export function parseAgentResponse(raw) {
  let value = raw;
  if (typeof raw === "string") {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { value = JSON.parse(cleaned); } catch { value = { reply: cleaned }; }
  }
  if (value?.data && typeof value.data === "object") value = value.data;
  const reply = String(value?.reply ?? value?.message ?? value?.content ?? "").trim();
  if (!reply) throw new Error("Agent response does not contain a reply");
  if (reply.length > 20_000) throw new Error("Agent reply exceeds 20000 characters");
  const attention = value?.attention && typeof value.attention === "object"
    ? { title: String(value.attention.title || "需要人工关注").slice(0, 160), detail: String(value.attention.detail || "").slice(0, 1000) }
    : null;
  return {
    reply,
    state: typeof value?.state === "string" ? value.state : "",
    tags: Array.isArray(value?.tags) ? value.tags.map(String).slice(0, 20) : [],
    attention,
    handoff: value?.handoff === true,
    source: "agent",
    responseId: value?.response_id || randomUUID()
  };
}
