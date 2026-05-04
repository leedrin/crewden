import type { Agent, AgentDelivery } from '@crewden/shared';
import { paseoRuntimeService } from './paseo-runtime-service.js';
import { deliverWithRetry } from './delivery-reliability.js';
import { isRuntimeSupported, markUnsupportedRuntime } from './runtime-support.js';

export type DeliverToAgentParams = {
  target: Agent;
  seq: number;
  channelId: string;
  message: AgentDelivery;
  inboxSummary?: string;
};

/**
 * Runtime delivery seam used by route handlers.
 */
export async function deliverToAgent(params: DeliverToAgentParams): Promise<boolean> {
  const { target, seq, channelId, message, inboxSummary } = params;
  if (target.status === 'inactive') return false;
  if (!isRuntimeSupported(target.runtime)) {
    await markUnsupportedRuntime(target, 'runtime-delivery-seam');
    return false;
  }
  return deliverWithRetry(target, 'runtime-delivery-seam', async () => paseoRuntimeService.deliverMessage({
    target,
    seq,
    channelId,
    message,
    inboxSummary,
  }));
}
