import type { Channel, Decision, Document, Message, Task, TaskStatus } from '@crewden/shared';

export type NewMessage = Omit<Message, 'createdAt' | 'actorType' | 'actorId'> &
  Partial<Pick<Message, 'actorType' | 'actorId'>>;

export type NewTask = Omit<Task, 'createdAt' | 'updatedAt' | 'version' | 'type' | 'creator' | 'owner' | 'reviewer' | 'isBlocked'> &
  Partial<Pick<Task, 'type' | 'creator' | 'owner' | 'reviewer' | 'isBlocked'>>;

export type TaskPatch = Partial<Pick<Task, 'status' | 'assigneeId' | 'owner' | 'reviewer' | 'acceptanceCriteria' | 'definitionOfDone' | 'constraints' | 'dependsOn' | 'isBlocked' | 'blockedReason' | 'context'>>;

export type ThreadView = {
  root: Message;
  replies: Message[];
  linkedDecisions?: Decision[];
  linkedDocuments?: Document[];
};

export interface TaskMessageRepository {
  getChannel(id: string): Channel | undefined;
  listChannels(): Channel[];
  findChannel(value: string): Channel | undefined;
  withThreadSummary(message: Message, channelMessages?: Message[]): Message;
  getMessage(id: string): Message | undefined;
  listMessages(channelId: string): Message[];
  listRecentMessages(channelId: string, limit: number): Message[];
  searchMessages(query: string, limit: number): Array<Message & { channelName: string }>;
  getThread(messageId: string): ThreadView | undefined;
  listTasks(filter?: { channelId?: string; status?: TaskStatus; assigneeId?: string }): Task[];
  getTask(id: string): Task | undefined;
  createMessage(message: NewMessage): Message;
  createTask(task: NewTask): Task;
  updateTask(id: string, patch: TaskPatch): Task | undefined;
  addContextPackageRef(taskId: string, refType: string, refId: string, refUpdatedAt: string): void;
  removeContextPackageRefsForTask(taskId: string): void;
  findTaskIdsByRef(refType: string, refId: string): string[];
  markContextPackagesStale(refType: string, refId: string): number;
}

export type Row = Record<string, string | number | null>;
export type SqlStorage = DurableObjectState['storage']['sql'];
