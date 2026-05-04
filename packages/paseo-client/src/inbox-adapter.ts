import type { AgentDelivery } from "@crewden/shared";

type QueuedDelivery = AgentDelivery & { formattedContent?: string };

type SendFn = (agentId: string, text: string) => Promise<void>;

export class InboxAdapter {
  private queues = new Map<string, QueuedDelivery[]>();
  private processing = new Map<string, boolean>();

  enqueue(agentId: string, delivery: AgentDelivery, send: SendFn): Promise<void> {
    const queue = this.getOrCreateQueue(agentId);
    queue.push(delivery);
    return this.tryDeliverNext(agentId, send);
  }

  onAgentIdle(agentId: string, send: SendFn): Promise<void> {
    this.processing.set(agentId, false);
    return this.tryDeliverNext(agentId, send);
  }

  hasQueued(agentId: string): boolean {
    return (this.queues.get(agentId)?.length ?? 0) > 0;
  }

  queueLength(agentId: string): number {
    return this.queues.get(agentId)?.length ?? 0;
  }

  isProcessing(agentId: string): boolean {
    return this.processing.get(agentId) ?? false;
  }

  clear(agentId: string): void {
    this.queues.delete(agentId);
    this.processing.delete(agentId);
  }

  private async tryDeliverNext(agentId: string, send: SendFn): Promise<void> {
    if (this.processing.get(agentId)) return;
    const queue = this.queues.get(agentId);
    if (!queue || queue.length === 0) return;

    this.processing.set(agentId, true);
    const delivery = queue.shift()!;
    try {
      await send(agentId, delivery.content);
    } catch (err) {
      queue.unshift(delivery);
      this.processing.set(agentId, false);
      throw err;
    }
  }

  private getOrCreateQueue(agentId: string): QueuedDelivery[] {
    let queue = this.queues.get(agentId);
    if (!queue) {
      queue = [];
      this.queues.set(agentId, queue);
    }
    return queue;
  }
}
