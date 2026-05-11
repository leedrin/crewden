import type { TaskType, PlanStatus, ApprovalStatus } from '@crewden/shared';

export type GateCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string };

const HIGH_RISK_TYPES: TaskType[] = ['feature', 'bug'];
const LOW_RISK_TYPES: TaskType[] = ['chore', 'research', 'docs'];
const PLAN_EXEMPT_TYPES: TaskType[] = ['docs', 'research'];

export function requiresPlan(taskType: TaskType): boolean {
  return !PLAN_EXEMPT_TYPES.includes(taskType);
}

export function requiresApproval(taskType: TaskType): boolean {
  return HIGH_RISK_TYPES.includes(taskType);
}

export function checkExecutionGate(params: {
  taskType: TaskType;
  planStatus?: PlanStatus;
  approvalStatus?: ApprovalStatus;
}): GateCheckResult {
  const { taskType, planStatus, approvalStatus } = params;

  if (!requiresPlan(taskType)) {
    return { allowed: true };
  }

  if (!planStatus) {
    return { allowed: false, reason: `${taskType} task requires a plan before execution` };
  }

  if (planStatus !== 'approved') {
    return { allowed: false, reason: `Plan must be approved before execution (current: ${planStatus})` };
  }

  if (requiresApproval(taskType)) {
    if (!approvalStatus) {
      return { allowed: false, reason: `${taskType} task requires human approval before execution` };
    }
    if (approvalStatus !== 'approved') {
      return { allowed: false, reason: `Approval must be granted before execution (current: ${approvalStatus})` };
    }
  }

  return { allowed: true };
}

export function shouldCreateApprovalOnPlanApproval(taskType: TaskType): boolean {
  return requiresApproval(taskType);
}
