const DEFAULT_SILENT_REPLY_INSTRUCTION = [
  "当客户消息只是确认、附和、感谢或结束语，没有提出新问题、请求、异议、负面情绪，",
  "也没有提供需要继续处理的新信息时，可以静默结束对话。",
  "如果消息中同时包含问题、请求、异常反馈或需要继续处理的信息，必须正常回复。"
].join("");

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function normalizeActivationMessage(raw = {}) {
  const source = typeof raw === "string" ? { content: raw } : raw || {};
  const content = text(source.content);
  if (!content) return null;
  return {
    content,
    intervalMinutes: nonNegativeInteger(source.intervalMinutes, 30),
    maxTimes: Math.max(1, Number.parseInt(source.maxTimes ?? 1, 10) || 1)
  };
}

export function normalizeActivation(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    enabled: Boolean(source.enabled),
    polishByAgent: source.polishByAgent !== false,
    messages: Array.isArray(source.messages) ? source.messages.map(normalizeActivationMessage).filter(Boolean) : []
  };
}

export function normalizeFlowConfig(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
  if (!rawNodes.length) throw new TypeError("flow machine requires at least one node");
  const nodes = rawNodes.map((node, index) => ({
    id: text(node?.id, `node_${index + 1}`),
    name: text(node?.name, `节点 ${index + 1}`),
    goal: text(node?.goal),
    completionCriteria: text(node?.completionCriteria),
    collectFields: Array.isArray(node?.collectFields) ? node.collectFields.map(text).filter(Boolean) : [],
    conversationTips: Array.isArray(node?.conversationTips) ? node.conversationTips.map(text).filter(Boolean) : [],
    silentReply: {
      enabled: Boolean(node?.silentReply?.enabled),
      instruction: text(node?.silentReply?.instruction, DEFAULT_SILENT_REPLY_INSTRUCTION) || DEFAULT_SILENT_REPLY_INSTRUCTION
    },
    activation: normalizeActivation(node?.activation),
    nextNodeId: text(node?.nextNodeId),
    transitions: Array.isArray(node?.transitions) ? node.transitions : []
  }));
  if (nodes.some((node) => !/^[a-z][a-z0-9_]{1,79}$/i.test(node.id) || !node.name)) {
    throw new TypeError("each flow node requires a valid id and name");
  }
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) throw new TypeError("flow node ids must be unique");
  const entryNodeId = text(source.entryNodeId, nodes[0].id);
  if (!ids.has(entryNodeId)) throw new TypeError("entryNodeId must match a node id");
  for (const node of nodes) {
    if (node.nextNodeId && !ids.has(node.nextNodeId)) throw new TypeError(`nextNodeId not found: ${node.nextNodeId}`);
  }
  return {
    name: text(source.name, "默认客服流程") || "默认客服流程",
    version: text(source.version, "1.0.0") || "1.0.0",
    entryNodeId,
    generalRule: text(source.generalRule),
    nodes
  };
}

export function defaultFlowConfig(name = "客服") {
  return normalizeFlowConfig({
    name: `${name}任务流程`,
    version: "1.0.0",
    entryNodeId: "collect_basic_info",
    generalRule: "始终以客户当前问题为中心，信息不足时逐步追问，不重复索取客户已经提供的信息。",
    nodes: [
      {
        id: "collect_basic_info",
        name: "收集基础信息",
        goal: "理解客户需求，收集后续服务所需的基础信息。",
        completionCriteria: "客户需求和至少一种有效联系方式已经明确。",
        collectFields: ["客户需求", "联系方式"],
        conversationTips: ["先回应客户问题，再自然追问缺失信息", "不要一次提出过多问题"],
        nextNodeId: "invite_next_step"
      },
      {
        id: "invite_next_step",
        name: "邀请下一步",
        goal: "根据客户需求给出清晰方案并邀请客户进入下一步。",
        completionCriteria: "客户明确接受、拒绝或要求稍后跟进。",
        collectFields: ["意向方案"],
        conversationTips: ["用具体行动建议代替泛泛介绍"],
        nextNodeId: "follow_up"
      },
      {
        id: "follow_up",
        name: "持续跟进",
        goal: "处理疑问与异议，确认客户的最终决定。",
        completionCriteria: "客户已经做出明确决定或当前事项已处理完毕。",
        collectFields: ["最终决定"],
        conversationTips: ["针对异议提供可验证的信息"],
        nextNodeId: "close_deal"
      },
      {
        id: "close_deal",
        name: "完成任务",
        goal: "完成交付确认，并在没有新问题时结束对话。",
        completionCriteria: "任务已经完成且客户没有新的待处理问题。",
        collectFields: [],
        conversationTips: ["简洁确认结果和后续联系方法"],
        nextNodeId: "",
        silentReply: { enabled: true, instruction: DEFAULT_SILENT_REPLY_INSTRUCTION }
      }
    ]
  });
}

export function compactFlowForAgent({ machine, session }) {
  if (!machine?.enabled || !machine.config || !session) return null;
  const node = machine.config.nodes.find((item) => item.id === session.currentNodeId);
  if (!node) return null;
  return {
    name: machine.config.name,
    version: machine.config.version,
    generalRule: machine.config.generalRule,
    currentNode: node,
    collectedData: session.collectedData || {},
    allowedNextNodeId: node.nextNodeId || "",
    terminal: !node.nextNodeId
  };
}

export function validateFlowDecision(raw, { flowContext } = {}) {
  if (!flowContext) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("flowDecision is required when a flow context is provided");
  if (typeof raw.nodeCompleted !== "boolean") throw new TypeError("flowDecision.nodeCompleted must be a boolean");
  const currentNodeId = text(flowContext.currentNode?.id);
  const declaredCurrentNodeId = text(raw.currentNodeId);
  if (declaredCurrentNodeId && declaredCurrentNodeId !== currentNodeId) {
    throw new TypeError("flowDecision.currentNodeId must match the current node");
  }
  const patch = raw.collectedDataPatch && typeof raw.collectedDataPatch === "object" && !Array.isArray(raw.collectedDataPatch)
    ? raw.collectedDataPatch
    : {};
  const allowedFields = new Set(flowContext.currentNode.collectFields || []);
  const collectedDataPatch = {};
  for (const [rawField, value] of Object.entries(patch)) {
    const field = text(rawField);
    if (!allowedFields.has(field)) throw new TypeError(`flowDecision.collectedDataPatch.${field} is not configured for the current node`);
    if (!["string", "number", "boolean"].includes(typeof value) || (typeof value === "string" && !value.trim())) {
      throw new TypeError(`flowDecision.collectedDataPatch.${field} must contain a value`);
    }
    collectedDataPatch[field] = typeof value === "string" ? value.trim() : value;
  }
  const nextNodeId = text(raw.nextNodeId);
  if (!raw.nodeCompleted && nextNodeId && nextNodeId !== currentNodeId) {
    throw new TypeError("flowDecision.nextNodeId must remain on the current node when nodeCompleted=false");
  }
  if (raw.nodeCompleted && nextNodeId !== (flowContext.allowedNextNodeId || "")) {
    throw new TypeError("flowDecision.nextNodeId must match the configured next node");
  }
  return {
    currentNodeId,
    nodeCompleted: raw.nodeCompleted,
    nextNodeId: raw.nodeCompleted ? nextNodeId : currentNodeId,
    collectedDataPatch,
    confidence: Number.isFinite(Number(raw.confidence)) ? Math.min(1, Math.max(0, Number(raw.confidence))) : null,
    reason: text(raw.reason).slice(0, 1000)
  };
}
