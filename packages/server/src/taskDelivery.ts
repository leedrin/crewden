import type { Agent, Task } from '@crewden/shared';
import { nanoid } from 'nanoid';
import { getStore } from './db.js';
import { eventBus } from './events.js';
import { matchesAgentCapability } from './taskMatching.js';
import { paseoRuntimeService } from './runtime/paseo-runtime-service.js';
import { deliverWithRetry } from './runtime/delivery-reliability.js';
import { isRuntimeSupported, markUnsupportedRuntime } from './runtime/runtime-support.js';

const ACTIVE_STATUSES = new Set(['starting', 'running', 'working', 'idle']);

export async function notifyTaskAssignee(task: Task): Promise<void> {
  if (!task.assigneeId || task.status === 'done' || task.status === 'cancelled') return;
  const store = getStore();
  if (await hasOpenDependencies(task)) return;
  const target = await store.findAgentByNameOrId(task.assigneeId);
  if (!target) return;

  const message = toTaskDelivery(task);
  const inboxSummary = await buildOpenTaskSummary(target);
  if (!isRuntimeSupported(target.runtime)) {
    await markUnsupportedRuntime(target, 'task-notify');
    return;
  }
  if (ACTIVE_STATUSES.has(target.status)) {
    await deliverWithRetry(target, 'task-notify', async () => paseoRuntimeService.deliverMessage({
      target,
      seq: Date.now(),
      channelId: message.channelId,
      message,
      inboxSummary,
    }));
    return;
  }

  if (!target.autoStart) return;
  const machineId = paseoRuntimeService.resolveStartMachineId(target);
  if (!machineId) return;

  const sent = await paseoRuntimeService.startAgent({
    agent: target,
    machineId,
    launchId: nanoid(),
    wakeMessage: message,
    inboxSummary,
  });
  if (!sent) return;
  const updated = await store.updateAgent(target.id, { machineId });
  if (updated) eventBus.emit({ type: 'agent:update', agent: updated });
}

export async function notifyTasksBlockedBy(blockerTaskId: string): Promise<void> {
  const tasks = await getStore().listTasks();
  for (const task of tasks) {
    if (task.context?.blockedByTaskIds?.includes(blockerTaskId)) {
      await notifyTaskAssignee(task);
    }
  }
}

async function hasOpenDependencies(task: Task): Promise<boolean> {
  const blockedByTaskIds = task.context?.blockedByTaskIds ?? [];
  if (blockedByTaskIds.length === 0) return false;
  const store = getStore();
  for (const taskId of blockedByTaskIds) {
    const blocker = await store.getTask(taskId);
    if (!blocker || blocker.status !== 'done') return true;
  }
  return false;
}

export async function buildOpenTaskSummary(agent: Agent): Promise<string | undefined> {
  const tasks = await getStore().listTasks({ projectId: agent.projectId ?? 'default' });
  const assignedTasks = tasks
    .filter((task) => task.status !== 'done' && task.status !== 'cancelled' && task.assigneeId === agent.id)
    .slice(0, 20);
  const claimableTasks = tasks
    .filter((task) => task.status !== 'done' && task.status !== 'cancelled' && !task.assigneeId && matchesAgentCapability(agent, task))
    .slice(0, Math.max(0, 20 - assignedTasks.length));
  if (assignedTasks.length === 0 && claimableTasks.length === 0) return undefined;
  const sections: string[] = [];
  if (assignedTasks.length > 0) {
    sections.push(
      'Open tasks assigned to you:',
      ...assignedTasks.map(formatTaskSummaryLine)
    );
  }
  if (claimableTasks.length > 0) {
    if (sections.length > 0) sections.push('');
    sections.push(
      'Claimable unassigned tasks matching your role/capability:',
      ...claimableTasks.map(formatTaskSummaryLine)
    );
  }
  return [
    ...sections,
    '',
    'Use `crewden_inbox` for queue context, then `crewden_get_task`, `crewden_claim_task`, `crewden_update_task`, `crewden_progress_task`, `crewden_block_task`, and `crewden_handoff_task` to manage them.',
  ].join('\n');
}

function formatTaskSummaryLine(task: Task): string {
  const goal = task.context?.goal ? ` goal: ${task.context.goal}` : '';
  return `- ${task.id} [${task.status}] #${task.channelId}: ${task.title}${goal}`;
}

export function toTaskDelivery(task: Task) {
  return {
    id: `task:${task.id}:${task.updatedAt}`,
    channelId: task.channelId,
    channelName: `#${task.channelId}`,
    senderName: 'task-board',
    content: [
      `Task assigned or updated: ${task.title}`,
      `Task ID: ${task.id}`,
      `Status: ${task.status}`,
      `Channel: ${task.channelId}`,
      task.context?.goal ? `Goal: ${task.context.goal}` : undefined,
      task.context?.background ? `Background: ${task.context.background}` : undefined,
      task.context?.handoffNotes?.length ? `Latest handoff: ${task.context.handoffNotes.at(-1)}` : undefined,
      '',
      'Use `crewden_get_task` for details, `crewden_update_task`/`crewden_progress_task` for progress, and `crewden_block_task` when blocked.',
    ].filter(Boolean).join('\n'),
    threadRootId: task.sourceThreadId ?? task.messageId,
    createdAt: task.updatedAt,
  };
}
