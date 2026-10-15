import { compactFlowForAgent } from "../flow-machine.js";
import { compactTagRulesForAgent } from "../tags.js";

export class MessageService {
  constructor({ store, registry, gateway, delivery }) {
    this.store = store;
    this.registry = registry;
    this.gateway = gateway;
    this.delivery = delivery;
  }

  async receive({ provider, accountId, payload, secret = "" }) {
    const account = this.store.getAccount(accountId, { includeSecrets: true });
    if (!account || account.provider !== provider) {
      const error = new Error("Channel account not found");
      error.status = 404;
      throw error;
    }
    if (!account.enabled) {
      const error = new Error("Channel account is disabled");
      error.status = 409;
      throw error;
    }
    if (account.webhookSecret && secret !== account.webhookSecret) {
      const error = new Error("Invalid channel secret");
      error.status = 401;
      throw error;
    }
    const events = await this.registry.get(provider).normalizeInbound({ accountId, payload });
    const results = [];
    for (const event of events) results.push(await this.#processEvent(account, event));
    return results;
  }

  async #processEvent(account, event) {
    const received = this.store.recordInbound(event);
    if (received.duplicate) return { eventId: event.eventId, duplicate: true };
    const { conversation, message } = received;
    if (conversation.mode === "human") return { eventId: event.eventId, conversationId: conversation.id, messageId: message.id, handledBy: "human" };

    try {
      const flow = this.store.getFlowContext(conversation.id);
      const flowContext = compactFlowForAgent(flow);
      const tagSchema = this.store.getTagSchema(account.id).config;
      const tagContext = compactTagRulesForAgent({ schema: tagSchema, currentTags: this.store.listConversationTags(conversation.id) });
      const decision = await this.gateway.reply({
        account,
        conversation,
        inboundMessage: message,
        history: this.store.conversationContext(conversation.id),
        flowContext,
        tagContext
      });
      if (decision.flowDecision) this.store.applyFlowDecision(conversation.id, decision.flowDecision, "agent");
      const currentFlow = this.store.getFlowContext(conversation.id);
      const currentNode = currentFlow.machine.enabled
        ? currentFlow.machine.config.nodes.find((node) => node.id === currentFlow.session.currentNodeId)
        : null;
      if (currentNode?.activation?.enabled) this.store.scheduleActivation(conversation.id, { sourceType: "flow", sourceKey: currentNode.id, activation: currentNode.activation });
      const tagResult = this.store.applyTagDecision(conversation.id, decision.tagDecision, { source: "agent", evidenceMessageId: message.id });
      const newlyMatched = tagResult.accepted.filter((item) => item.action === "add" || item.action === "replace");
      const matchedDefinitions = newlyMatched.map((action) => tagSchema.groups.find((group) => group.id === action.groupId)?.tags.find((tag) => tag.id === action.tagId)).filter(Boolean);
      for (const tag of matchedDefinitions.filter((item) => item.activation?.enabled)) {
        const action = newlyMatched.find((item) => item.tagId === tag.id);
        this.store.scheduleActivation(conversation.id, { sourceType: "tag", sourceKey: `${action.groupId}:${tag.id}`, activation: tag.activation });
      }
      for (const tag of matchedDefinitions.filter((item) => item.voiceAlertEnabled)) {
        this.store.createAlert(conversation.id, message.id, { title: `标签提醒：${tag.name}`, detail: newlyMatched.find((item) => item.tagId === tag.id)?.reason || "客户命中关注标签" });
      }
      if (decision.attentionAlert) this.store.createAlert(conversation.id, message.id, decision.attentionAlert);
      const tagHandoff = matchedDefinitions.find((item) => item.handoffEnabled);
      if (decision.handoff || tagHandoff) this.store.setConversationMode(conversation.id, "human", { operator: "agent", note: decision.attentionAlert?.detail || (tagHandoff ? `命中标签：${tagHandoff.name}` : "Agent requested handoff") });
      const outbound = decision.reply
        ? await this.delivery.send({ account, conversation, content: decision.reply, senderType: "agent", metadata: { agentSource: decision.source } })
        : null;
      if (!outbound) this.store.audit(account.id, conversation.id, "agent", "agent.silent_reply", { messageId: message.id });
      return { eventId: event.eventId, conversationId: conversation.id, messageId: message.id, outboundMessageId: outbound?.id || null, handledBy: "agent" };
    } catch (error) {
      this.store.createAlert(conversation.id, message.id, { title: "Agent 处理失败", detail: String(error.message || error) });
      this.store.audit(account.id, conversation.id, "agent", "agent.failed", { error: String(error.message || error), messageId: message.id });
      return { eventId: event.eventId, conversationId: conversation.id, messageId: message.id, handledBy: "error", error: String(error.message || error) };
    }
  }
}
