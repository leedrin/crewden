import type { TaskStatus } from '@crewden/shared';

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ['spec_needed', 'ready', 'cancelled'],
  spec_needed: ['ready', 'backlog'],
  ready: ['assigned', 'backlog', 'cancelled'],
  assigned: ['in_progress', 'ready', 'cancelled'],
  in_progress: ['in_review', 'cancelled'],
  in_review: ['changes_requested', 'qa', 'done', 'cancelled'],
  changes_requested: ['in_progress', 'cancelled'],
  qa: ['done', 'changes_requested', 'cancelled'],
  done: [],
  cancelled: [],
};

export function isTaskTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertValidTransition(from: TaskStatus, to: TaskStatus): void {
  if (!isTaskTransitionAllowed(from, to)) {
    throw new Error(`Invalid task status transition from ${from} to ${to}`);
  }
}

export function getAllowedTransitions(from: TaskStatus): TaskStatus[] {
  return [...ALLOWED_TRANSITIONS[from]];
}

export const TERMINAL_STATUSES: TaskStatus[] = ['done', 'cancelled'];
