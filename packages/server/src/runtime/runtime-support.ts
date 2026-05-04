import type { Agent, RuntimeId } from "@crewden/shared";
import { getStore } from "../db.js";
import { eventBus } from "../events.js";

export function isRuntimeSupported(runtime: RuntimeId): boolean {
  return runtime === "claude" || runtime === "codex" || runtime === "opencode" || runtime === "pi";
}

export function unsupportedRuntimeError(runtime: RuntimeId): string {
  if (runtime === "gemini") {
    return `Runtime '${runtime}' is not supported in Paseo mode yet.`;
  }
  return `Runtime '${runtime}' is not supported in Paseo mode. Please use claude, codex, opencode, or pi.`;
}

export async function markUnsupportedRuntime(agent: Agent, source: string): Promise<void> {
  const store = getStore();
  const error = unsupportedRuntimeError(agent.runtime);

  const updated = await store.updateAgent(agent.id, {
    status: "error",
    autoStart: false,
  });
  if (updated) {
    eventBus.emit({ type: "agent:update", agent: updated });
  }

  const activity = await store.createAgentActivity({
    id: crypto.randomUUID(),
    agentId: agent.id,
    type: "error",
    detail: error,
  });
  eventBus.emit({ type: "agent:activity", agentId: agent.id, activity });

  await store.appendAuditLog({
    actorType: "system",
    action: "runtime.unsupported",
    entityType: "agent",
    entityId: agent.id,
    agentId: agent.id,
    detailJson: {
      source,
      runtime: agent.runtime,
      error,
    },
  });
}

export async function reconcileUnsupportedRuntimeAgents(): Promise<void> {
  const store = getStore();
  const agents = await store.listAgents();
  for (const agent of agents) {
    if (isRuntimeSupported(agent.runtime)) continue;
    if (agent.status === "inactive" || agent.status === "error") continue;
    await markUnsupportedRuntime(agent, "startup-reconcile");
  }
}
