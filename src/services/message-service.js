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
      const decision = await this.gateway.reply({
        account,
        conversation,
        inboundMessage: message,
        history: this.store.conversationContext(conversation.id),
        stateMachine: this.store.getStateMachine(account.id)
      });
      if (decision.state) this.store.setConversationState(conversation.id, decision.state, "agent");
      if (decision.tags.length) this.store.assignTags(conversation.id, decision.tags, { source: "agent", evidenceMessageId: message.id });
      if (decision.attention) this.store.createAlert(conversation.id, message.id, decision.attention);
      if (decision.handoff) this.store.setConversationMode(conversation.id, "human", { operator: "agent", note: decision.attention?.detail || "Agent requested handoff" });
      const outbound = await this.delivery.send({ account, conversation, content: decision.reply, senderType: "agent", metadata: { agentSource: decision.source } });
      return { eventId: event.eventId, conversationId: conversation.id, messageId: message.id, outboundMessageId: outbound.id, handledBy: "agent" };
    } catch (error) {
      this.store.createAlert(conversation.id, message.id, { title: "Agent 处理失败", detail: String(error.message || error) });
      this.store.audit(account.id, conversation.id, "agent", "agent.failed", { error: String(error.message || error), messageId: message.id });
      return { eventId: event.eventId, conversationId: conversation.id, messageId: message.id, handledBy: "error", error: String(error.message || error) };
    }
  }
}
