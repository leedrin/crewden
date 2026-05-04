import type { Agent } from "@crewden/shared";
import { getStore } from "../db.js";

const RETRY_DELAYS_MS = [150, 350];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function deliverWithRetry(
  agent: Agent,
  source: string,
  delivery: () => Promise<boolean>,
): Promise<boolean> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const delivered = await delivery();
      if (delivered) return true;
    } catch (error) {
      if (attempt === RETRY_DELAYS_MS.length) {
        await recordDeadLetter(agent, source, error instanceof Error ? error.message : String(error));
        return false;
      }
    }

    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]!);
      continue;
    }

    await recordDeadLetter(agent, source, "Delivery returned false after retries");
    return false;
  }

  await recordDeadLetter(agent, source, "Delivery exhausted retries");
  return false;
}

async function recordDeadLetter(agent: Agent, source: string, reason: string): Promise<void> {
  const store = getStore();
  await store.appendAuditLog({
    actorType: "system",
    action: "runtime.dead_letter",
    entityType: "agent",
    entityId: agent.id,
    agentId: agent.id,
    detailJson: {
      source,
      runtime: agent.runtime,
      reason,
    },
  });
}

type CachedMessage = { expiresAt: number; message: unknown };
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const idempotencyCache = new Map<string, CachedMessage>();

export function getCachedIdempotentMessage(key: string): unknown | undefined {
  pruneIdempotencyCache();
  const hit = idempotencyCache.get(key);
  if (!hit) return undefined;
  return hit.message;
}

export function cacheIdempotentMessage(key: string, message: unknown): void {
  pruneIdempotencyCache();
  idempotencyCache.set(key, { message, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

function pruneIdempotencyCache(): void {
  const now = Date.now();
  for (const [key, value] of idempotencyCache.entries()) {
    if (value.expiresAt <= now) {
      idempotencyCache.delete(key);
    }
  }
}
