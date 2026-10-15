import { randomUUID } from "node:crypto";
import { defineAdapter, normalizeDeliveryCommand, normalizeInboundEvent } from "../contract.js";

export function createPollingAdapter(provider, publish) {
  return defineAdapter({
    provider,
    capabilities: Object.freeze({
      privateChats: true,
      text: true,
      media: true,
      deliveryReceipts: true,
      readReceipts: true,
      proactiveMessages: true
    }),
    normalizeInbound({ accountId, payload }) {
      const conversation = payload?.conversation || {};
      const message = payload?.message || {};
      return [normalizeInboundEvent({
        provider,
        accountId,
        eventId: String(payload?.event_id || payload?.eventId || message.id || randomUUID()),
        occurredAt: String(payload?.occurred_at || payload?.occurredAt || new Date().toISOString()),
        externalConversationId: String(conversation.id || payload?.conversation_id || payload?.conversationId || ""),
        externalUserId: String(conversation.user_id || conversation.userId || payload?.user_id || payload?.userId || ""),
        displayName: String(conversation.display_name || conversation.displayName || payload?.display_name || payload?.displayName || ""),
        externalMessageId: String(message.id || payload?.message_id || payload?.messageId || randomUUID()),
        messageType: String(message.type || payload?.message_type || payload?.messageType || "text"),
        text: String(message.text ?? payload?.text ?? ""),
        attachments: message.attachments || payload?.attachments || [],
        metadata: { ...payload?.metadata, channelPayloadVersion: 1 }
      })];
    },
    async send(command) {
      const normalized = normalizeDeliveryCommand(command);
      const providerMessageId = `${provider}_${randomUUID()}`;
      await publish({ provider, providerMessageId, ...normalized });
      return Object.freeze({ accepted: true, status: "queued", providerMessageId });
    },
    async health() {
      return { ok: true, mode: "poll", checkedAt: new Date().toISOString() };
    }
  });
}
