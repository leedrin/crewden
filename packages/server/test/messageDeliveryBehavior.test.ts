import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { getStore, resetStore } from '../src/db.js';
import { paseoRuntimeService } from '../src/runtime/paseo-runtime-service.js';

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetStore();
});

describe('message delivery behavior', () => {
  it('passes queue behavior to runtime delivery', async () => {
    const deliverSpy = vi.spyOn(paseoRuntimeService, 'deliverMessage').mockResolvedValue(true);
    const app = await buildApp();
    const store = getStore();
    await store.createAgent({
      id: 'agent-queue',
      name: 'agent-queue',
      runtime: 'claude',
      status: 'idle',
      createdAt: new Date().toISOString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: {
        senderName: 'user',
        content: 'queue this',
        agentId: 'agent-queue',
        deliveryBehavior: 'queue',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(deliverSpy).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({ id: 'agent-queue' }),
      deliveryBehavior: 'queue',
    }));
    await app.close();
  });

  it('defaults to interrupt behavior when not provided', async () => {
    const deliverSpy = vi.spyOn(paseoRuntimeService, 'deliverMessage').mockResolvedValue(true);
    const app = await buildApp();
    const store = getStore();
    await store.createAgent({
      id: 'agent-default',
      name: 'agent-default',
      runtime: 'claude',
      status: 'idle',
      createdAt: new Date().toISOString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: {
        senderName: 'user',
        content: 'default behavior',
        agentId: 'agent-default',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(deliverSpy).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({ id: 'agent-default' }),
      deliveryBehavior: 'interrupt',
    }));
    await app.close();
  });
});
