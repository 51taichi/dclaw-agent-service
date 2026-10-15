import { randomUUID } from "node:crypto";

export class DeliveryService {
  constructor({ store, registry, maxAttempts = 3 }) {
    this.store = store;
    this.registry = registry;
    this.maxAttempts = Math.max(1, Number(maxAttempts) || 3);
  }

  async send({ account, conversation, content, senderType = "agent", metadata = {} }) {
    const message = this.store.createOutbound(conversation.id, { content, senderType, metadata });
    const idempotencyKey = `delivery:${message.id}:${randomUUID()}`;
    const deliveryId = this.store.createDelivery({ messageId: message.id, accountId: account.id, provider: account.provider, idempotencyKey });
    const command = {
      accountId: account.id,
      externalConversationId: conversation.externalConversationId,
      messageType: "text",
      text: content,
      attachments: [],
      idempotencyKey,
      metadata: { conversationId: conversation.id, messageId: message.id, ...metadata }
    };
    let lastError;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const result = await this.registry.get(account.provider).send(command);
        this.store.finishDelivery(deliveryId, { status: result.status || "sent", providerMessageId: result.providerMessageId || "" });
        this.store.audit(account.id, conversation.id, "message", "message.sent", { messageId: message.id, provider: account.provider, status: result.status, attempt });
        return this.store.getMessage(message.id);
      } catch (error) {
        lastError = error;
        this.store.finishDelivery(deliveryId, { status: "failed", error: String(error.message || error) });
        this.store.audit(account.id, conversation.id, "delivery", attempt < this.maxAttempts ? "delivery.retrying" : "delivery.failed", { messageId: message.id, attempt, error: String(error.message || error) });
      }
    }
    this.store.createAlert(conversation.id, message.id, { title: "消息投递失败", detail: String(lastError?.message || lastError) });
    throw lastError;
  }
}
