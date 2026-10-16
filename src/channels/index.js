import { ChannelRegistry } from "./registry.js";
import { createPollingAdapter } from "./adapters/polling.js";

export function createChannelRegistry({ publish }) {
  return new ChannelRegistry()
    .register(createPollingAdapter("website", publish))
    .register(createPollingAdapter("miniapp", publish));
}
