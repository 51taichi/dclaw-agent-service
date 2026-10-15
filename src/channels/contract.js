const PROVIDER_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

export const CAPABILITY_KEYS = Object.freeze([
  "privateChats",
  "text",
  "media",
  "deliveryReceipts",
  "readReceipts",
  "proactiveMessages"
]);

export function defineAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") throw new TypeError("Channel adapter must be an object");
  if (!PROVIDER_PATTERN.test(adapter.provider || "")) throw new TypeError("Invalid channel provider id");
  for (const key of CAPABILITY_KEYS) {
    if (typeof adapter.capabilities?.[key] !== "boolean") throw new TypeError(`Missing channel capability: ${key}`);
  }
  for (const method of ["normalizeInbound", "send", "health"]) {
    if (typeof adapter[method] !== "function") throw new TypeError(`Missing channel adapter method: ${method}`);
  }
  return Object.freeze(adapter);
}

export function normalizeInboundEvent(event) {
  const required = ["provider", "accountId", "eventId", "occurredAt", "externalConversationId", "externalUserId", "externalMessageId"];
  for (const key of required) {
    if (typeof event?.[key] !== "string" || !event[key].trim()) throw new TypeError(`Invalid inbound event field: ${key}`);
  }
  if (!PROVIDER_PATTERN.test(event.provider)) throw new TypeError("Invalid inbound provider");
  const timestamp = new Date(event.occurredAt);
  if (Number.isNaN(timestamp.getTime())) throw new TypeError("Invalid inbound occurredAt");
  return Object.freeze({
    provider: event.provider,
    accountId: event.accountId,
    eventId: event.eventId,
    occurredAt: timestamp.toISOString(),
    externalConversationId: event.externalConversationId,
    externalUserId: event.externalUserId,
    displayName: String(event.displayName || event.externalUserId),
    externalMessageId: event.externalMessageId,
    messageType: String(event.messageType || "text"),
    text: String(event.text || ""),
    attachments: Array.isArray(event.attachments) ? structuredClone(event.attachments) : [],
    metadata: event.metadata && typeof event.metadata === "object" ? structuredClone(event.metadata) : {}
  });
}

export function normalizeDeliveryCommand(command) {
  for (const key of ["accountId", "externalConversationId", "messageType", "idempotencyKey"]) {
    if (typeof command?.[key] !== "string" || !command[key].trim()) throw new TypeError(`Invalid delivery command field: ${key}`);
  }
  return Object.freeze({
    accountId: command.accountId,
    externalConversationId: command.externalConversationId,
    messageType: command.messageType,
    text: String(command.text || ""),
    attachments: Array.isArray(command.attachments) ? structuredClone(command.attachments) : [],
    idempotencyKey: command.idempotencyKey,
    metadata: command.metadata && typeof command.metadata === "object" ? structuredClone(command.metadata) : {}
  });
}
