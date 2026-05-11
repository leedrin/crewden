import { describe, it, expect } from 'vitest';
import { isTaskTransitionAllowed, assertValidTransition, getAllowedTransitions, TERMINAL_STATUSES } from '../src/taskStateMachine.js';
import type { TaskStatus } from '@crewden/shared';

const ALL_STATUSES: TaskStatus[] = [
  'backlog', 'spec_needed', 'ready', 'assigned', 'in_progress',
  'in_review', 'changes_requested', 'qa', 'done', 'cancelled',
];

describe('isTaskTransitionAllowed', () => {
  it('allows same-status transition', () => {
    for (const status of ALL_STATUSES) {
      expect(isTaskTransitionAllowed(status, status)).toBe(true);
    }
  });

  it('allows backlog -> spec_needed', () => {
    expect(isTaskTransitionAllowed('backlog', 'spec_needed')).toBe(true);
  });

  it('allows backlog -> ready', () => {
    expect(isTaskTransitionAllowed('backlog', 'ready')).toBe(true);
  });

  it('allows backlog -> cancelled', () => {
    expect(isTaskTransitionAllowed('backlog', 'cancelled')).toBe(true);
  });

  it('allows spec_needed -> ready', () => {
    expect(isTaskTransitionAllowed('spec_needed', 'ready')).toBe(true);
  });

  it('allows spec_needed -> backlog', () => {
    expect(isTaskTransitionAllowed('spec_needed', 'backlog')).toBe(true);
  });

  it('allows ready -> assigned', () => {
    expect(isTaskTransitionAllowed('ready', 'assigned')).toBe(true);
  });

  it('allows ready -> backlog', () => {
    expect(isTaskTransitionAllowed('ready', 'backlog')).toBe(true);
  });

  it('allows ready -> cancelled', () => {
    expect(isTaskTransitionAllowed('ready', 'cancelled')).toBe(true);
  });

  it('allows assigned -> in_progress', () => {
    expect(isTaskTransitionAllowed('assigned', 'in_progress')).toBe(true);
  });

  it('allows assigned -> ready', () => {
    expect(isTaskTransitionAllowed('assigned', 'ready')).toBe(true);
  });

  it('allows assigned -> cancelled', () => {
    expect(isTaskTransitionAllowed('assigned', 'cancelled')).toBe(true);
  });

  it('allows in_progress -> in_review', () => {
    expect(isTaskTransitionAllowed('in_progress', 'in_review')).toBe(true);
  });

  it('allows in_progress -> cancelled', () => {
    expect(isTaskTransitionAllowed('in_progress', 'cancelled')).toBe(true);
  });

  it('allows in_review -> changes_requested', () => {
    expect(isTaskTransitionAllowed('in_review', 'changes_requested')).toBe(true);
  });

  it('allows in_review -> qa', () => {
    expect(isTaskTransitionAllowed('in_review', 'qa')).toBe(true);
  });

  it('allows in_review -> done', () => {
    expect(isTaskTransitionAllowed('in_review', 'done')).toBe(true);
  });

  it('allows in_review -> cancelled', () => {
    expect(isTaskTransitionAllowed('in_review', 'cancelled')).toBe(true);
  });

  it('allows changes_requested -> in_progress', () => {
    expect(isTaskTransitionAllowed('changes_requested', 'in_progress')).toBe(true);
  });

  it('allows changes_requested -> cancelled', () => {
    expect(isTaskTransitionAllowed('changes_requested', 'cancelled')).toBe(true);
  });

  it('allows qa -> done', () => {
    expect(isTaskTransitionAllowed('qa', 'done')).toBe(true);
  });

  it('allows qa -> changes_requested', () => {
    expect(isTaskTransitionAllowed('qa', 'changes_requested')).toBe(true);
  });

  it('allows qa -> cancelled', () => {
    expect(isTaskTransitionAllowed('qa', 'cancelled')).toBe(true);
  });

  it('disallows done -> any', () => {
    for (const to of ALL_STATUSES) {
      if (to === 'done') continue;
      expect(isTaskTransitionAllowed('done', to)).toBe(false);
    }
  });

  it('disallows cancelled -> any', () => {
    for (const to of ALL_STATUSES) {
      if (to === 'cancelled') continue;
      expect(isTaskTransitionAllowed('cancelled', to)).toBe(false);
    }
  });

  it('disallows invalid forward transitions', () => {
    expect(isTaskTransitionAllowed('backlog', 'in_progress')).toBe(false);
    expect(isTaskTransitionAllowed('backlog', 'done')).toBe(false);
    expect(isTaskTransitionAllowed('ready', 'in_progress')).toBe(false);
    expect(isTaskTransitionAllowed('assigned', 'in_review')).toBe(false);
    expect(isTaskTransitionAllowed('in_progress', 'done')).toBe(false);
  });

  it('disallows backward transitions from terminal', () => {
    expect(isTaskTransitionAllowed('done', 'backlog')).toBe(false);
    expect(isTaskTransitionAllowed('cancelled', 'backlog')).toBe(false);
    expect(isTaskTransitionAllowed('done', 'in_progress')).toBe(false);
  });
});

describe('assertValidTransition', () => {
  it('does not throw for valid transitions', () => {
    expect(() => assertValidTransition('backlog', 'ready')).not.toThrow();
    expect(() => assertValidTransition('in_progress', 'in_review')).not.toThrow();
  });

  it('throws for invalid transitions', () => {
    expect(() => assertValidTransition('done', 'backlog')).toThrow('Invalid task status transition');
  });
});

describe('getAllowedTransitions', () => {
  it('returns correct transitions for backlog', () => {
    expect(getAllowedTransitions('backlog')).toEqual(['spec_needed', 'ready', 'cancelled']);
  });

  it('returns empty for done', () => {
    expect(getAllowedTransitions('done')).toEqual([]);
  });

  it('returns empty for cancelled', () => {
    expect(getAllowedTransitions('cancelled')).toEqual([]);
  });

  it('returns a copy (not the original array)', () => {
    const first = getAllowedTransitions('backlog');
    const second = getAllowedTransitions('backlog');
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});

describe('TERMINAL_STATUSES', () => {
  it('contains done and cancelled', () => {
    expect(TERMINAL_STATUSES).toEqual(['done', 'cancelled']);
  });
});
