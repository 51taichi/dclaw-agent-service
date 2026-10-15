import { createPollingAdapter } from "./polling.js";

export function createFakeAdapter(publish) {
  return createPollingAdapter("fake", publish);
}
