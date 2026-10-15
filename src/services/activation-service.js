export class ActivationService {
  constructor({ store, gateway, delivery, intervalMs = 2_000 }) {
    this.store = store;
    this.gateway = gateway;
    this.delivery = delivery;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.runDue().catch((error) => console.error("Activation worker failed", error)), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async runDue() {
    if (this.running) return [];
    this.running = true;
    const results = [];
    try {
      for (const task of this.store.claimDueActivations()) {
        const conversation = this.store.getConversation(task.conversationId);
        const account = conversation ? this.store.getAccount(task.accountId, { includeSecrets: true }) : null;
        if (!conversation || !account || conversation.mode === "human" || !account.enabled) {
          this.store.finishActivation(task.id, { status: "canceled" });
          results.push({ id: task.id, status: "canceled" });
          continue;
        }
        try {
          if (!this.store.isActivationProcessing(task.id)) continue;
          const content = task.polishByAgent
            ? await this.gateway.polishActivation({ account, conversation, content: task.content })
            : task.content;
          if (!this.store.isActivationProcessing(task.id)) continue;
          await this.delivery.send({ account, conversation, content, senderType: "agent", metadata: { activation: true, activationTaskId: task.id, sourceType: task.sourceType, sourceKey: task.sourceKey } });
          if (this.store.finishActivation(task.id, { status: "sent" })) {
            this.store.audit(account.id, conversation.id, "activation", "activation.sent", { taskId: task.id, sourceType: task.sourceType, sourceKey: task.sourceKey });
            results.push({ id: task.id, status: "sent" });
          }
        } catch (error) {
          this.store.finishActivation(task.id, { status: "failed", error: String(error.message || error) });
          this.store.createAlert(conversation.id, null, { title: "客户激活发送失败", detail: String(error.message || error) });
          results.push({ id: task.id, status: "failed" });
        }
      }
      return results;
    } finally {
      this.running = false;
    }
  }
}
