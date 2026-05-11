import { describe, it, expect } from 'vitest';
import { requiresPlan, requiresApproval, checkExecutionGate, shouldCreateApprovalOnPlanApproval } from '../src/approvalRules.js';

describe('approvalRules', () => {
  describe('requiresPlan', () => {
    it('requires plan for feature tasks', () => {
      expect(requiresPlan('feature')).toBe(true);
    });

    it('requires plan for bug tasks', () => {
      expect(requiresPlan('bug')).toBe(true);
    });

    it('requires plan for chore tasks', () => {
      expect(requiresPlan('chore')).toBe(true);
    });

    it('does not require plan for docs tasks', () => {
      expect(requiresPlan('docs')).toBe(false);
    });

    it('does not require plan for research tasks', () => {
      expect(requiresPlan('research')).toBe(false);
    });
  });

  describe('requiresApproval', () => {
    it('requires approval for feature tasks', () => {
      expect(requiresApproval('feature')).toBe(true);
    });

    it('requires approval for bug tasks', () => {
      expect(requiresApproval('bug')).toBe(true);
    });

    it('does not require approval for chore tasks', () => {
      expect(requiresApproval('chore')).toBe(false);
    });

    it('does not require approval for docs tasks', () => {
      expect(requiresApproval('docs')).toBe(false);
    });
  });

  describe('checkExecutionGate', () => {
    it('allows docs tasks without plan', () => {
      expect(checkExecutionGate({ taskType: 'docs' })).toEqual({ allowed: true });
    });

    it('allows research tasks without plan', () => {
      expect(checkExecutionGate({ taskType: 'research' })).toEqual({ allowed: true });
    });

    it('blocks feature task without plan', () => {
      const result = checkExecutionGate({ taskType: 'feature' });
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toContain('requires a plan');
    });

    it('blocks feature task with draft plan', () => {
      const result = checkExecutionGate({ taskType: 'feature', planStatus: 'draft' });
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toContain('approved');
    });

    it('blocks feature task with approved plan but no approval', () => {
      const result = checkExecutionGate({ taskType: 'feature', planStatus: 'approved' });
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toContain('human approval');
    });

    it('blocks feature task with approved plan and rejected approval', () => {
      const result = checkExecutionGate({ taskType: 'feature', planStatus: 'approved', approvalStatus: 'rejected' });
      expect(result.allowed).toBe(false);
    });

    it('allows feature task with approved plan and approved approval', () => {
      expect(checkExecutionGate({ taskType: 'feature', planStatus: 'approved', approvalStatus: 'approved' })).toEqual({ allowed: true });
    });

    it('allows chore task with approved plan (no approval needed)', () => {
      expect(checkExecutionGate({ taskType: 'chore', planStatus: 'approved' })).toEqual({ allowed: true });
    });

    it('blocks chore task without plan', () => {
      const result = checkExecutionGate({ taskType: 'chore' });
      expect(result.allowed).toBe(false);
    });

    it('blocks bug task with submitted plan', () => {
      const result = checkExecutionGate({ taskType: 'bug', planStatus: 'submitted' });
      expect(result.allowed).toBe(false);
    });
  });

  describe('shouldCreateApprovalOnPlanApproval', () => {
    it('returns true for feature', () => {
      expect(shouldCreateApprovalOnPlanApproval('feature')).toBe(true);
    });

    it('returns true for bug', () => {
      expect(shouldCreateApprovalOnPlanApproval('bug')).toBe(true);
    });

    it('returns false for chore', () => {
      expect(shouldCreateApprovalOnPlanApproval('chore')).toBe(false);
    });

    it('returns false for docs', () => {
      expect(shouldCreateApprovalOnPlanApproval('docs')).toBe(false);
    });
  });
});
