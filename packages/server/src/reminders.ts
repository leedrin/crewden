import { nanoid } from 'nanoid';
import { getDb, getStore } from './db.js';
import { eventBus } from './events.js';
import { SqliteApprovalRepository } from './repository/approval.repository.js';

export async function triggerDueReminders(now = new Date()): Promise<number> {
  const store = getStore();
  const due = await store.listDueReminders(now.toISOString());
  let triggered = 0;
  for (const reminder of due) {
    const latest = await store.getReminder(reminder.id);
    if (!latest || latest.status !== 'pending') continue;
    const agent = await store.getAgent(reminder.agentId);
    const message = await store.createMessage({
      id: nanoid(),
      channelId: reminder.channelId,
      agentId: reminder.agentId,
      senderName: agent?.displayName ?? agent?.name ?? reminder.agentId,
      content: reminder.message,
    });
    eventBus.emit({ type: 'message:new', message });
    const updated = await store.updateReminder(reminder.id, { status: 'triggered' });
    if (updated) eventBus.emit({ type: 'reminder:update', reminder: updated });
    triggered += 1;
  }
  return triggered;
}

export async function expireDueApprovals(now = new Date()): Promise<number> {
  const repo = new SqliteApprovalRepository(getDb());
  const expired = await repo.expireOverdue(now.toISOString());
  for (const approval of expired) eventBus.emit({ type: 'approval:update', approval });
  return expired.length;
}

export function startReminderScheduler(intervalMs = 10000): () => void {
  const timer = setInterval(() => {
    Promise.all([
      triggerDueReminders(),
      expireDueApprovals(),
    ]).catch((err) => {
      console.error('[reminders] scheduler failed', err);
    });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
