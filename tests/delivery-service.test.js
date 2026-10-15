import test from "node:test";
import assert from "node:assert/strict";
import { DeliveryService, resolveConfiguredCards } from "../src/services/delivery-service.js";

test("delivery retries through the adapter with one stable idempotency key", async () => {
  const calls = [];
  const finished = [];
  let attempts = 0;
  const store = {
    createOutbound: () => ({ id: 41 }),
    createDelivery: () => 9,
    finishDelivery: (_id, value) => finished.push(value),
    audit: () => {},
    getMessage: () => ({ id: 41, deliveryStatus: "queued" }),
    createAlert: () => { throw new Error("alert should not be created after a successful retry"); }
  };
  const registry = {
    get: () => ({
      async send(command) {
        calls.push(command);
        attempts += 1;
        if (attempts < 3) throw new Error("temporary outage");
        return { status: "queued", providerMessageId: "provider-41" };
      }
    })
  };
  const service = new DeliveryService({ store, registry, maxAttempts: 3 });
  const result = await service.send({
    account: { id: "website-default", provider: "website" },
    conversation: { id: 7, externalConversationId: "session-7" },
    content: "hello"
  });

  assert.equal(result.id, 41);
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((item) => item.idempotencyKey)).size, 1);
  assert.deepEqual(finished.map((item) => item.status), ["failed", "failed", "queued"]);
});

test("configured card markers become adapter-neutral card attachments", () => {
  const resolved = resolveConfiguredCards({
    content: "资料在这里：\n{{card id=\"card-1\" name=\"资料包\"}}\n请查收",
    account: { config: { cardTemplates: { "card-1": { name: "资料包", title: "学习资料", url: "https://example.test/card", pictureUrl: "https://example.test/cover.jpg" } } } }
  });
  assert.equal(resolved.content, "资料在这里：\n\n请查收");
  assert.deepEqual(resolved.attachments, [{
    type: "card",
    id: "card-1",
    name: "资料包",
    title: "学习资料",
    subtitle: "",
    url: "https://example.test/card",
    pictureUrl: "https://example.test/cover.jpg"
  }]);
});
