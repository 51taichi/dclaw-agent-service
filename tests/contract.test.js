import test from "node:test";
import assert from "node:assert/strict";
import { ChannelRegistry } from "../src/channels/registry.js";
import { createPollingAdapter } from "../src/channels/adapters/polling.js";

test("registry resolves adapters without exposing provider branches to core services", () => {
  const registry = new ChannelRegistry().register(createPollingAdapter("website", async () => {}));
  assert.equal(registry.get("website").provider, "website");
  assert.throws(() => registry.get("missing"), /Unsupported channel provider/);
});

test("polling adapter rejects inbound payloads without a conversation identity", () => {
  const adapter = createPollingAdapter("miniapp", async () => {});
  assert.throws(() => adapter.normalizeInbound({ accountId: "miniapp-default", payload: { message: { id: "m1", text: "hello" } } }), /externalConversationId/);
});
