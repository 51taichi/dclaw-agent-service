import { randomUUID } from "node:crypto";

export class DeliveryService {
  constructor({ store, registry, maxAttempts = 3 }) {
    this.store = store;
    this.registry = registry;
    this.maxAttempts = Math.max(1, Number(maxAttempts) || 3);
  }

  async send({ account, conversation, content, attachments = [], senderType = "agent", metadata = {} }) {
    const resolved = resolveConfiguredCards({ content, attachments, account });
    const messageType = resolved.attachments.length ? "rich" : "text";
    const message = this.store.createOutbound(conversation.id, {
      content: resolved.content,
      senderType,
      messageType,
      metadata: { ...metadata, attachments: resolved.attachments }
    });
    const idempotencyKey = `delivery:${message.id}:${randomUUID()}`;
    const deliveryId = this.store.createDelivery({ messageId: message.id, accountId: account.id, provider: account.provider, idempotencyKey });
    const command = {
      accountId: account.id,
      externalConversationId: conversation.externalConversationId,
      messageType,
      text: resolved.content,
      attachments: resolved.attachments,
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

const CARD_MARKER = /\{\{card\s+id="([^"]+)"\s+name="([^"]*)"\}\}/gu;

export function resolveConfiguredCards({ content, attachments = [], account }) {
  const cards = account?.config?.cardTemplates && typeof account.config.cardTemplates === "object"
    ? account.config.cardTemplates
    : {};
  const resolvedAttachments = Array.isArray(attachments) ? structuredClone(attachments) : [];
  const resolvedContent = String(content || "").replace(CARD_MARKER, (_marker, id, fallbackName) => {
    const card = cards[id];
    if (!card || !/^https?:\/\//i.test(String(card.url || ""))) return `[${fallbackName || id}]`;
    resolvedAttachments.push({
      type: "card",
      id,
      name: String(card.name || fallbackName || id),
      title: String(card.title || card.name || fallbackName || id),
      subtitle: String(card.subtitle || ""),
      url: String(card.url),
      pictureUrl: String(card.pictureUrl || "")
    });
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim();
  return { content: resolvedContent, attachments: resolvedAttachments };
}
