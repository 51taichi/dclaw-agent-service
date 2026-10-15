import { ChannelRegistry } from "./registry.js";
import { createPollingAdapter } from "./adapters/polling.js";
import { createFakeAdapter } from "./adapters/fake.js";

export function createChannelRegistry({ publish }) {
  return new ChannelRegistry()
    .register(createPollingAdapter("website", publish))
    .register(createPollingAdapter("miniapp", publish))
    .register(createFakeAdapter(publish));
}
