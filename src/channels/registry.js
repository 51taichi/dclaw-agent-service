import { defineAdapter } from "./contract.js";

export class ChannelRegistry {
  #adapters = new Map();

  register(adapter) {
    const valid = defineAdapter(adapter);
    if (this.#adapters.has(valid.provider)) throw new Error(`渠道适配器已注册：${valid.provider}`);
    this.#adapters.set(valid.provider, valid);
    return this;
  }

  get(provider) {
    const adapter = this.#adapters.get(provider);
    if (!adapter) {
      const error = new Error(`不支持该渠道类型：${provider}`);
      error.status = 404;
      throw error;
    }
    return adapter;
  }

  list() {
    return [...this.#adapters.values()].map(({ provider, capabilities }) => ({ provider, capabilities }));
  }
}
