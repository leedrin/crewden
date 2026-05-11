import type { Task, TaskStatus, Message, SearchMessageResult, ThreadStatus, ThreadParticipant, MessageThread, Project, Channel } from '@crewden/shared';

export type TaskPatch = Partial<Pick<Task, 'status' | 'assigneeId' | 'owner' | 'reviewer' | 'acceptanceCriteria' | 'definitionOfDone' | 'constraints' | 'dependsOn' | 'isBlocked' | 'blockedReason' | 'context'>>;
export type NewTask = Omit<Task, 'createdAt' | 'updatedAt' | 'version' | 'type' | 'creator' | 'owner' | 'reviewer' | 'isBlocked' | 'projectId'> &
  Partial<Pick<Task, 'type' | 'creator' | 'owner' | 'reviewer' | 'isBlocked' | 'projectId'>>;
export type NewMessage = Omit<Message, 'createdAt' | 'actorType' | 'actorId' | 'projectId'> & Partial<Pick<Message, 'actorType' | 'actorId' | 'projectId'>>;

export type ThreadSummaryRow = {
  threadRootId: string;
  projectId: string;
  title?: string;
  status: ThreadStatus;
  summaryContent?: string;
  summaryGeneratedAt?: string;
  linkedDecisions: string[];
  linkedDocuments: string[];
  linkedTasks: string[];
  messageCount: number;
  participants: ThreadParticipant[];
  createdAt?: string;
  resolvedAt?: string;
};

export interface TaskRepository {
  list(filter: { projectId?: string; channelId?: string; status?: TaskStatus; assigneeId?: string }): Promise<Task[]>;
  getById(id: string): Promise<Task | undefined>;
  create(task: NewTask): Promise<Task>;
  update(id: string, patch: TaskPatch): Promise<Task | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface ProjectRepository {
  list(): Promise<Project[]>;
  getById(id: string): Promise<Project | undefined>;
  getBySlug(slug: string): Promise<Project | undefined>;
  create(input: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<Project>;
  update(id: string, patch: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Project | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface ChannelRepository {
  list(filter?: { projectId?: string }): Promise<Channel[]>;
  getById(id: string, filter?: { projectId?: string }): Promise<Channel | undefined>;
  create(id: string, name: string, projectId: string): Promise<Channel>;
  delete(id: string): Promise<boolean>;
}

export interface MessageRepository {
  listByChannel(channelId: string): Promise<Message[]>;
  listRecent(channelId: string, limit: number): Promise<Message[]>;
  search(query: string, limit: number, projectId?: string): Promise<SearchMessageResult[]>;
  getById(id: string): Promise<Message | undefined>;
  create(msg: NewMessage): Promise<Message>;
  appendContent(id: string, appendText: string): Promise<Message | undefined>;
}

export interface ThreadRepository {
  getSummary(rootId: string): Promise<ThreadSummaryRow | undefined>;
  setThreadStatus(rootId: string, status: ThreadStatus): Promise<ThreadSummaryRow | undefined>;
  refreshSummary(rootId: string, options?: { status?: ThreadStatus; forceSummary?: boolean }): Promise<ThreadSummaryRow | undefined>;
  getThread(rootId: string): Promise<MessageThread | undefined>;
}

export interface ContextPackageRefRepository {
  addRef(taskId: string, refType: string, refId: string, refUpdatedAt: string): Promise<void>;
  removeRefsForTask(taskId: string): Promise<void>;
  findTaskIdsByRef(refType: string, refId: string): Promise<string[]>;
}
