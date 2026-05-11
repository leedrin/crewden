import { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { ChannelView } from './components/ChannelView.js';
import { Composer } from './components/Composer.js';
import { AgentPanel } from './components/AgentPanel.js';
import { AgentDetailPanel } from './components/AgentDetailPanel.js';
import { TaskBoard } from './components/TaskBoard.js';
import { ThreadPanel } from './components/ThreadPanel.js';
import { InboxPanel } from './components/InboxPanel.js';
import { GoalDraftPanel } from './components/GoalDraftPanel.js';
import { GoalAlignmentPanel } from './components/GoalAlignmentPanel.js';
import { KnowledgePanel } from './components/KnowledgePanel.js';
import { MobileTopBar } from './components/MobileTopBar.js';
import { LoginView } from './components/LoginView.js';
import type { Channel, Message, MessageThread, Agent, Machine, AgentActivity, VersionInfo, Task, Reminder, SearchMessageResult, GoalBrief, GoalAlignment, RuntimeStatus, Project, DeliveryBehavior, Plan, Approval } from './api.js';
import { AuthError, WEB_COMMIT_SHA, WEB_VERSION, buildWsUrl, getProjects, getChannels, getMessages, getMessageThread, sendMessage, getAgents, getMachines, getAgentActivities, getHubVersion, getTasks, messageToTask, startGoalAlignment, getAgentReminders, createChannel, deleteChannel, searchMessages, setAuthFailureHandler, verifyAuthToken, getRuntimeStatus, reopenThread, resolveThread } from './api.js';
import { clearStoredAuthToken, getEffectiveAuthToken, markSignedOut, setStoredAuthToken } from './auth.js';
import { notifyBrowser, requestPermission } from './notifications.js';

const LAST_PAGE_KEY = 'crewden_last_page';
const LAST_PROJECT_ID_KEY = 'crewden_last_project_id';
const SEND_BEHAVIOR_KEY = 'crewden_send_behavior';
const LEFT_SIDEBAR_WIDTH_KEY = 'crewden_left_sidebar_width';
const RIGHT_SIDEBAR_WIDTH_KEY = 'crewden_right_sidebar_width';
const LEFT_SIDEBAR_HIDDEN_KEY = 'crewden_left_sidebar_hidden';
const RIGHT_SIDEBAR_HIDDEN_KEY = 'crewden_right_sidebar_hidden';

type MainView = 'channel' | 'tasks' | 'knowledge' | 'inbox';
type StoredPage = {
  selectedView: MainView;
  selectedChannel: string;
  selectedAgentId?: string;
  rightPanel?: 'agents';
};

export function App() {
  const initialPageRef = useRef<StoredPage>();
  if (!initialPageRef.current) initialPageRef.current = readLastPage();
  const initialPage = initialPageRef.current;
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'login'>('checking');
  const [authError, setAuthError] = useState<string | undefined>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => localStorage.getItem(LAST_PROJECT_ID_KEY) ?? 'default');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messagesByChannel, setMessagesByChannel] = useState<Record<string, Message[]>>({});
  const [draftsByChannel, setDraftsByChannel] = useState<Record<string, string>>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | undefined>();
  const [hubVersion, setHubVersion] = useState<VersionInfo | undefined>();
  const [activitiesByAgent, setActivitiesByAgent] = useState<Record<string, AgentActivity[]>>({});
  const [remindersByAgent, setRemindersByAgent] = useState<Record<string, Reminder[]>>({});
  const [selectedView, setSelectedView] = useState<MainView>(initialPage.selectedView);
  const [selectedChannel, setSelectedChannel] = useState(initialPage.selectedChannel);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(initialPage.selectedAgentId);
  const [rightPanel, setRightPanel] = useState<'agents' | undefined>(initialPage.rightPanel);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [thread, setThread] = useState<MessageThread | undefined>();
  const [goalDraft, setGoalDraft] = useState<GoalBrief | undefined>();
  const [goalAlignment, setGoalAlignment] = useState<GoalAlignment | undefined>();
  const [targetMessageId, setTargetMessageId] = useState<string | undefined>();
  const [threadTargetMessageId, setThreadTargetMessageId] = useState<string | undefined>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState<boolean>(() => isDesktopViewport());
  const [leftSidebarWidth, setLeftSidebarWidth] = useState<number>(() => readStoredNumber(LEFT_SIDEBAR_WIDTH_KEY, 240, 200, 420));
  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(() => readStoredNumber(RIGHT_SIDEBAR_WIDTH_KEY, 360, 280, 620));
  const [leftSidebarHidden, setLeftSidebarHidden] = useState<boolean>(() => readStoredBoolean(LEFT_SIDEBAR_HIDDEN_KEY, false));
  const [rightSidebarHidden, setRightSidebarHidden] = useState<boolean>(() => readStoredBoolean(RIGHT_SIDEBAR_HIDDEN_KEY, false));
  const [sendBehavior, setSendBehavior] = useState<DeliveryBehavior>(() => {
    const stored = localStorage.getItem(SEND_BEHAVIOR_KEY);
    return stored === 'queue' ? 'queue' : 'interrupt';
  });
  const [queueStateByAgent, setQueueStateByAgent] = useState<Record<string, { depth: number; processing: boolean }>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const selectedChannelRef = useRef(selectedChannel);
  const resizeRef = useRef<{
    side: 'left' | 'right';
    startX: number;
    startWidth: number;
  } | null>(null);
  const isAuthenticated = authState === 'authenticated';

  const resetWorkspaceState = useCallback(() => {
    setProjects([]);
    setChannels([]);
    setMessagesByChannel({});
    setDraftsByChannel({});
    setAgents([]);
    setMachines([]);
    setTasks([]);
    setRuntimeStatus(undefined);
    setHubVersion(undefined);
    setActivitiesByAgent({});
    setRemindersByAgent({});
    setSelectedView('channel');
    setSelectedChannel('general');
    setSelectedAgentId(undefined);
    setRightPanel(undefined);
    setSidebarOpen(false);
    setThread(undefined);
    setGoalDraft(undefined);
    setGoalAlignment(undefined);
    setTargetMessageId(undefined);
    setThreadTargetMessageId(undefined);
    setSearchOpen(false);
  }, []);

  const handleAuthExpired = useCallback(() => {
    clearStoredAuthToken();
    wsRef.current?.close();
    resetWorkspaceState();
    setAuthError('Session expired. Sign in again.');
    setAuthState('login');
  }, [resetWorkspaceState]);

  const handleSignOut = useCallback(() => {
    markSignedOut();
    wsRef.current?.close();
    resetWorkspaceState();
    setAuthError(undefined);
    setAuthState('login');
  }, [resetWorkspaceState]);

  const handleSignIn = useCallback(async (token: string) => {
    try {
      await verifyAuthToken(token);
      setStoredAuthToken(token);
      setAuthError(undefined);
      setAuthState('authenticated');
    } catch (err) {
      setAuthError(err instanceof AuthError ? 'Invalid token' : 'Server unavailable');
      throw err;
    }
  }, []);

  useEffect(() => {
    setAuthFailureHandler(handleAuthExpired);
    return () => setAuthFailureHandler(undefined);
  }, [handleAuthExpired]);

  useEffect(() => {
    const token = getEffectiveAuthToken();
    verifyAuthToken(token)
      .then(() => {
        setAuthError(undefined);
        setAuthState('authenticated');
      })
      .catch((err) => {
        if (err instanceof AuthError) {
          clearStoredAuthToken();
          setAuthError(token ? 'Invalid token' : undefined);
        } else {
          setAuthError('Server unavailable');
        }
        setAuthState('login');
      });
  }, []);

  const loadProjects = useCallback(async () => {
    const data = await getProjects();
    setProjects(data);
    if (data.length === 0) return;
    const current = data.find((project) => project.id === selectedProjectId);
    const fromPath = data.find((project) => project.slug === readProjectSlugFromPath());
    const fallback = fromPath ?? current ?? data[0];
    if (fallback.id !== selectedProjectId) setSelectedProjectId(fallback.id);
  }, [selectedProjectId]);

  const loadChannels = useCallback(async () => {
    const data = await getChannels(selectedProjectId);
    setChannels(data);
  }, [selectedProjectId]);

  const loadMessages = useCallback(async (channelId: string) => {
    const data = await getMessages(channelId);
    setMessagesByChannel((prev) => ({ ...prev, [channelId]: data }));
  }, []);

  const loadAgents = useCallback(async () => {
    const data = await getAgents({ projectId: selectedProjectId });
    setAgents(data);
  }, [selectedProjectId]);

  const loadMachines = useCallback(async () => {
    const data = await getMachines();
    setMachines(data);
  }, []);

  const loadTasks = useCallback(async () => {
    const data = await getTasks({ projectId: selectedProjectId });
    setTasks(data);
  }, [selectedProjectId]);

  const loadRuntimeStatus = useCallback(async () => {
    const data = await getRuntimeStatus();
    setRuntimeStatus(data);
  }, []);

  const upsertMessage = useCallback((message: Message) => {
    setMessagesByChannel((prev) => {
      const current = prev[message.channelId] ?? [];
      return {
        ...prev,
        [message.channelId]: current.some((candidate) => candidate.id === message.id)
          ? current.map((candidate) => (candidate.id === message.id ? message : candidate))
          : [...current, message],
      };
    });
  }, []);

  const updateThreadRoot = useCallback((root: Message) => {
    setMessagesByChannel((prev) => {
      const current = prev[root.channelId] ?? [];
      return {
        ...prev,
        [root.channelId]: current.map((message) => (message.id === root.id ? root : message)),
      };
    });
    setThread((current) => current?.root.id === root.id ? { ...current, root } : current);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadProjects();
    loadChannels();
    loadAgents();
    loadMachines();
    loadTasks();
    loadRuntimeStatus();
    getHubVersion().then(setHubVersion).catch(() => undefined);
    requestPermission().catch(() => undefined);
  }, [isAuthenticated, loadAgents, loadChannels, loadMachines, loadProjects, loadRuntimeStatus, loadTasks]);

  useEffect(() => {
    if (!isAuthenticated) return;
    writeLastPage({ selectedView, selectedChannel, selectedAgentId, rightPanel });
  }, [isAuthenticated, rightPanel, selectedAgentId, selectedChannel, selectedView]);

  useEffect(() => {
    localStorage.setItem(SEND_BEHAVIOR_KEY, sendBehavior);
  }, [sendBehavior]);

  useEffect(() => {
    const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 1024px)')
      : undefined;
    if (!media) return;
    const apply = () => setIsDesktop(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    localStorage.setItem(LEFT_SIDEBAR_WIDTH_KEY, String(leftSidebarWidth));
  }, [leftSidebarWidth]);

  useEffect(() => {
    localStorage.setItem(RIGHT_SIDEBAR_WIDTH_KEY, String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  useEffect(() => {
    localStorage.setItem(LEFT_SIDEBAR_HIDDEN_KEY, leftSidebarHidden ? '1' : '0');
  }, [leftSidebarHidden]);

  useEffect(() => {
    localStorage.setItem(RIGHT_SIDEBAR_HIDDEN_KEY, rightSidebarHidden ? '1' : '0');
  }, [rightSidebarHidden]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const resize = resizeRef.current;
      if (!resize) return;
      if (resize.side === 'left') {
        const delta = event.clientX - resize.startX;
        setLeftSidebarWidth(clamp(resize.startWidth + delta, 200, 420));
      } else {
        const delta = resize.startX - event.clientX;
        setRightSidebarWidth(clamp(resize.startWidth + delta, 280, 620));
      }
    };
    const onMouseUp = () => {
      resizeRef.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    localStorage.setItem(LAST_PROJECT_ID_KEY, selectedProjectId);
    const selectedProject = projects.find((project) => project.id === selectedProjectId);
    if (!selectedProject) return;
    const nextPath = `/${selectedProject.slug}`;
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(null, '', `${nextPath}${window.location.search}${window.location.hash}`);
    }
  }, [isAuthenticated, projects, selectedProjectId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (channels.length === 0) return;
    if (!channels.some((channel) => channel.id === selectedChannel)) {
      const fallback = channels.find((channel) => channel.id === 'general') ?? channels[0];
      setSelectedChannel(fallback.id);
    }
  }, [channels, isAuthenticated, selectedChannel]);

  useEffect(() => {
    if (!isAuthenticated) return;
    selectedChannelRef.current = selectedChannel;
    loadMessages(selectedChannel);
  }, [isAuthenticated, loadMessages, selectedChannel]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !selectedAgentId) return;
    getAgentActivities(selectedAgentId).then((data) => {
      setActivitiesByAgent((prev) => ({ ...prev, [selectedAgentId]: data }));
    });
    getAgentReminders(selectedAgentId).then((data) => {
      setRemindersByAgent((prev) => ({ ...prev, [selectedAgentId]: data }));
    });
  }, [isAuthenticated, selectedAgentId]);

  useEffect(() => {
    if (!thread && !selectedAgentId && !rightPanel && !sidebarOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (sidebarOpen) setSidebarOpen(false);
      else if (thread) setThread(undefined);
      else if (selectedAgentId) setSelectedAgentId(undefined);
      else setRightPanel(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rightPanel, selectedAgentId, sidebarOpen, thread]);

  // WebSocket for real-time updates. Keep one connection alive and use refs for
  // channel-specific state so channel switching does not churn the socket.
  useEffect(() => {
    if (!isAuthenticated) return;
    let closedByEffect = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let reconnectDelay = 1000;

    const refreshCurrentState = () => {
      loadChannels();
      loadAgents();
      loadMachines();
      loadRuntimeStatus();
      loadTasks();
      loadMessages(selectedChannelRef.current);
    };

    const connect = () => {
      const ws = new WebSocket(buildWsUrl('/ws'));
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelay = 1000;
        refreshCurrentState();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'browser:ping', at: Date.now() }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'message:new') {
          if (msg.message.projectId && msg.message.projectId !== selectedProjectId) return;
          if (msg.message.channelId === selectedChannelRef.current) {
            upsertMessage(msg.message);
          }
          const sender: string = msg.message.senderName ?? msg.message.agentId ?? 'Someone';
          notifyBrowser(
            sender,
            { body: msg.message.content?.slice(0, 80), tag: `msg:${msg.message.id}` },
            'messages',
          );
        } else if (msg.type === 'thread:message:new') {
          if (msg.root.projectId && msg.root.projectId !== selectedProjectId) return;
          updateThreadRoot(msg.root);
          setThread((current) => {
            if (!current || current.root.id !== msg.root.id) return current;
            const replies = current.replies.some((reply) => reply.id === msg.message.id)
              ? current.replies.map((reply) => (reply.id === msg.message.id ? msg.message : reply))
              : [...current.replies, msg.message];
            return { ...current, root: msg.root, replies };
          });
          void (async () => {
            const fullThread = await getMessageThread(msg.root.id);
            setThread((current) => current?.root.id === msg.root.id ? fullThread : current);
          })().catch(() => undefined);
          const replySender: string = msg.message.senderName ?? msg.message.agentId ?? 'Someone';
          notifyBrowser(
            `${replySender} replied in thread`,
            { body: msg.message.content?.slice(0, 80), tag: `thread:${msg.message.id}` },
            'messages',
          );
        } else if (msg.type === 'agent:update' || msg.type === 'agent:updated') {
          if (msg.agent.projectId && msg.agent.projectId !== selectedProjectId) return;
          setAgents((prev) => prev.map((a) => (a.id === msg.agent.id ? msg.agent : a)));
          loadRuntimeStatus();
          const agentStatus: string = msg.agent.status;
          if (agentStatus === 'working' || agentStatus === 'idle') {
            const agentLabel: string = msg.agent.displayName ?? msg.agent.name ?? msg.agent.id;
            notifyBrowser(
              `Agent: ${agentLabel}`,
              { body: agentStatus === 'working' ? 'Started working' : 'Now idle', tag: `agent:${msg.agent.id}:status` },
              'agents',
            );
          }
        } else if (msg.type === 'agent:deleted') {
          setAgents((prev) => prev.filter((agent) => agent.id !== msg.agentId));
          setSelectedAgentId((current) => current === msg.agentId ? undefined : current);
          setActivitiesByAgent((prev) => omitKey(prev, msg.agentId));
          setRemindersByAgent((prev) => omitKey(prev, msg.agentId));
        } else if (msg.type === 'agent:activity') {
          setActivitiesByAgent((prev) => {
            const current = prev[msg.agentId] ?? [];
            if (current.some((activity) => activity.id === msg.activity.id)) return prev;
            return { ...prev, [msg.agentId]: [msg.activity, ...current].slice(0, 200) };
          });
          const detail: string = msg.activity.detail ?? '';
          const queueState = parseQueueState(detail);
          if (queueState) {
            setQueueStateByAgent((prev) => ({ ...prev, [msg.agentId]: queueState }));
          }
          if (detail.startsWith('permission:requested') || detail.startsWith('permission:resolved') || detail.startsWith('attention:permission')) {
            loadRuntimeStatus();
          }
        } else if (msg.type === 'machine:update') {
          setMachines((prev) => {
            const exists = prev.find((m) => m.id === msg.machine.id);
            if (exists) return prev.map((m) => (m.id === msg.machine.id ? msg.machine : m));
            return [...prev, msg.machine];
          });
        } else if (msg.type === 'task:update') {
          if (msg.task.projectId && msg.task.projectId !== selectedProjectId) return;
          setTasks((prev) => {
            const exists = prev.find((task) => task.id === msg.task.id);
            if (exists) return prev.map((task) => (task.id === msg.task.id ? msg.task : task));
            return [...prev, msg.task];
          });
          const taskStatus: string = msg.task.status;
          if (taskStatus === 'done' || msg.task.isBlocked || taskStatus === 'in_review' || taskStatus === 'changes_requested' || taskStatus === 'qa') {
            const statusLabel: Record<string, string> = { done: 'Done', in_review: 'Needs review', changes_requested: 'Changes requested', qa: 'QA', blocked: 'Blocked' };
            notifyBrowser(
              `Task ${msg.task.isBlocked ? statusLabel.blocked : statusLabel[taskStatus] ?? taskStatus}`,
              { body: msg.task.title?.slice(0, 80), tag: `task:${msg.task.id}:${taskStatus}` },
              'tasks',
            );
          }
        } else if (msg.type === 'goal:update') {
          // handled by goal panel refresh
        } else if (msg.type === 'plan:update') {
          setPlans((prev) => ({ ...prev, [msg.plan.taskId]: msg.plan }));
        } else if (msg.type === 'approval:update') {
          setApprovals((prev) => {
            const exists = prev.find((a) => a.id === msg.approval.id);
            if (exists) return prev.map((a) => (a.id === msg.approval.id ? msg.approval : a));
            return [msg.approval, ...prev];
          });
        } else if (msg.type === 'reminder:update') {
          if (msg.reminder.projectId && msg.reminder.projectId !== selectedProjectId) return;
          setRemindersByAgent((prev) => {
            const current = prev[msg.reminder.agentId] ?? [];
            const exists = current.some((reminder) => reminder.id === msg.reminder.id);
            return {
              ...prev,
              [msg.reminder.agentId]: exists
                ? current.map((reminder) => (reminder.id === msg.reminder.id ? msg.reminder : reminder))
                : [...current, msg.reminder],
            };
          });
        }
      };

      ws.onerror = () => {
        if (ws.readyState === WebSocket.CLOSED) handleAuthExpired();
        ws.close();
      };

      ws.onclose = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
        if (wsRef.current === ws) wsRef.current = null;
        if (closedByEffect) return;
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 15000);
      };
    };

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [handleAuthExpired, isAuthenticated, loadAgents, loadChannels, loadMachines, loadMessages, loadRuntimeStatus, loadTasks, selectedProjectId, updateThreadRoot, upsertMessage]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = setInterval(() => {
      loadRuntimeStatus().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [isAuthenticated, loadRuntimeStatus]);

  const handleSend = async (content: string, agentId?: string) => {
    const channelId = selectedChannel;
    const message = await sendMessage(channelId, 'user', content, agentId, undefined, sendBehavior);
    setDraftsByChannel((prev) => {
      if (!prev[channelId]) return prev;
      const { [channelId]: _sentDraft, ...rest } = prev;
      return rest;
    });
    if (message.channelId === selectedChannelRef.current) upsertMessage(message);
  };

  const handleOpenThread = async (message: Message) => {
    const rootId = message.threadRootId ?? message.id;
    if (!message.threadRootId) {
      setThread((current) => current?.root.id === rootId ? current : { root: message, replies: [] });
    }
    setRightSidebarHidden(false);
    setThreadTargetMessageId(undefined);
    setRightPanel(undefined);
    setSelectedAgentId(undefined);
    setGoalDraft(undefined);
    setGoalAlignment(undefined);
    setThread(await getMessageThread(rootId));
  };

  const handleOpenAgent = (agentId: string) => {
    setRightSidebarHidden(false);
    setSelectedView('channel');
    setSelectedAgentId(agentId);
    setThread(undefined);
    setThreadTargetMessageId(undefined);
    setRightPanel(undefined);
    setGoalDraft(undefined);
    setGoalAlignment(undefined);
  };

  const handleThreadSend = async (content: string, agentId?: string) => {
    if (!thread) return;
    const reply = await sendMessage(thread.root.channelId, 'user', content, agentId, thread.root.id, sendBehavior);
    const nextRoot = {
      ...thread.root,
      replyCount: (thread.root.replyCount ?? thread.replies.length) + 1,
      latestReplyAt: reply.createdAt,
    };
    updateThreadRoot(nextRoot);
    setThread((current) => current?.root.id === thread.root.id
      ? { root: nextRoot, replies: current.replies.some((candidate) => candidate.id === reply.id) ? current.replies : [...current.replies, reply] }
      : current);
  };

  const upsertTask = (task: Task) => {
    setTasks((prev) => prev.some((candidate) => candidate.id === task.id)
      ? prev.map((candidate) => (candidate.id === task.id ? task : candidate))
      : [...prev, task]);
  };

  const upsertReminder = (reminder: Reminder) => {
    setRemindersByAgent((prev) => {
      const current = prev[reminder.agentId] ?? [];
      return {
        ...prev,
        [reminder.agentId]: current.some((candidate) => candidate.id === reminder.id)
          ? current.map((candidate) => (candidate.id === reminder.id ? reminder : candidate))
          : [...current, reminder],
      };
    });
  };

  const handleMessageToTask = async (messageId: string) => {
    upsertTask(await messageToTask(messageId, { creatorName: 'user' }));
  };

  const handleMessageToGoal = async (messageId: string) => {
    const alignment = await startGoalAlignment(messageId, { requesterName: 'user' });
    setRightSidebarHidden(false);
    setGoalAlignment(alignment);
    setThread(await getMessageThread(alignment.threadRootId));
    setGoalDraft(undefined);
    setSelectedView('channel');
    setSelectedAgentId(undefined);
    setRightPanel(undefined);
  };

  const handleCreateChannel = async (name: string) => {
    const channel = await createChannel(name, selectedProjectId);
    setChannels((prev) => prev.some((candidate) => candidate.id === channel.id) ? prev : [...prev, channel]);
    setSelectedView('channel');
    setSelectedChannel(channel.id);
  };

  const handleDeleteChannel = async (id: string) => {
    await deleteChannel(id);
    setChannels((prev) => prev.filter((channel) => channel.id !== id));
    if (selectedChannel === id) setSelectedChannel('general');
  };

  const selectedChannelObj = channels.find((c) => c.id === selectedChannel);
  const selectedAgent = selectedAgentId ? agents.find((a) => a.id === selectedAgentId) : undefined;
  const currentMessages = messagesByChannel[selectedChannel] ?? [];
  const currentTitle = selectedView === 'tasks'
    ? 'Tasks'
    : selectedView === 'inbox'
      ? 'Inbox'
    : selectedView === 'knowledge'
      ? 'Knowledge'
    : selectedAgent
      ? selectedAgent.displayName ?? selectedAgent.name
      : `# ${selectedChannelObj?.name ?? selectedChannel}`;
  const rightPaneContent = goalAlignment ? (
    <GoalAlignmentPanel
      alignment={goalAlignment}
      agents={agents}
      onClose={() => setGoalAlignment(undefined)}
      onAlignmentUpdated={setGoalAlignment}
      onTasksCreated={(createdTasks) => {
        for (const task of createdTasks) upsertTask(task);
        setSelectedView('tasks');
      }}
    />
  ) : goalDraft ? (
    <GoalDraftPanel
      goal={goalDraft}
      agents={agents}
      onClose={() => setGoalDraft(undefined)}
      onGoalUpdated={setGoalDraft}
      onTasksCreated={(createdTasks) => {
        for (const task of createdTasks) upsertTask(task);
        setSelectedView('tasks');
      }}
    />
  ) : thread ? (
    <ThreadPanel
      root={thread.root}
      replies={thread.replies}
      status={thread.status}
      summaryContent={thread.summaryContent}
      summaryGeneratedAt={thread.summaryGeneratedAt}
      linkedDecisions={thread.linkedDecisions}
      linkedDocuments={thread.linkedDocuments}
      agents={agents}
      sendBehavior={sendBehavior}
      onSendBehaviorChange={setSendBehavior}
      queueStateByAgent={queueStateByAgent}
      activitiesByAgent={activitiesByAgent}
      targetMessageId={threadTargetMessageId}
      onClose={() => setRightSidebarHidden(true)}
      onSend={handleThreadSend}
      onResolve={async () => {
        const updated = await resolveThread(thread.root.id);
        setThread(updated);
        updateThreadRoot(updated.root);
      }}
      onReopen={async () => {
        const updated = await reopenThread(thread.root.id);
        setThread(updated);
        updateThreadRoot(updated.root);
      }}
      onOpenAgent={handleOpenAgent}
      onTargetMessageSettled={() => setThreadTargetMessageId(undefined)}
    />
  ) : selectedAgent ? (
    <AgentDetailPanel
      agent={selectedAgent}
      agents={agents}
      machines={machines}
      activities={activitiesByAgent[selectedAgent.id] ?? []}
      reminders={remindersByAgent[selectedAgent.id] ?? []}
      tasks={tasks}
      onReminderUpdated={upsertReminder}
      onAgentUpdated={(updated) => setAgents((prev) => prev.map((agent) => (agent.id === updated.id ? updated : agent)))}
      onAgentDeleted={(agentId) => {
        setAgents((prev) => prev.filter((agent) => agent.id !== agentId));
        setActivitiesByAgent((prev) => omitKey(prev, agentId));
        setRemindersByAgent((prev) => omitKey(prev, agentId));
        setSelectedAgentId(undefined);
      }}
      onClose={() => setRightSidebarHidden(true)}
    />
  ) : rightPanel === 'agents' ? (
    <AgentPanel
      projectId={selectedProjectId}
      agents={agents}
      machines={machines}
      runtimeStatus={runtimeStatus}
      onAgentsChange={loadAgents}
      onRuntimeStatusRefresh={loadRuntimeStatus}
      onClose={() => setRightSidebarHidden(true)}
    />
  ) : null;
  const hasRightPane = Boolean(rightPaneContent);
  const startResize = (side: 'left' | 'right') => (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isDesktop) return;
    resizeRef.current = {
      side,
      startX: event.clientX,
      startWidth: side === 'left' ? leftSidebarWidth : rightSidebarWidth,
    };
    event.preventDefault();
  };

  if (authState === 'checking') {
    return <div className="login-shell"><div className="login-card">Loading...</div></div>;
  }

  if (authState === 'login') {
    return <LoginView error={authError} onSignIn={handleSignIn} />;
  }

  const handleSearchSelect = async (result: SearchMessageResult) => {
    setSelectedView('channel');
    setSelectedChannel(result.channelId);
    setSearchOpen(false);
    setSelectedAgentId(undefined);
    if (result.threadRootId) {
      setRightSidebarHidden(false);
      setThread(await getMessageThread(result.threadRootId));
      setThreadTargetMessageId(result.id);
      setTargetMessageId(undefined);
      return;
    }
    setThread(undefined);
    setThreadTargetMessageId(undefined);
    setTargetMessageId(result.id);
  };

  return (
    <div className="app-shell" style={{ display: 'flex', height: '100vh', fontFamily: "'Courier New', monospace", background: '#fafaf5' }}>
      <MobileTopBar
        title={currentTitle}
        subtitle={thread ? 'Thread' : selectedView === 'tasks' ? `${tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled').length} open` : selectedView === 'inbox' ? 'Aggregated work' : selectedView === 'knowledge' ? 'Memory layer' : 'Workspace'}
        hasThread={!!thread}
        onOpenMenu={() => setSidebarOpen(true)}
        onOpenAgents={() => { setRightPanel('agents'); setRightSidebarHidden(false); setSelectedAgentId(undefined); setThread(undefined); setThreadTargetMessageId(undefined); setGoalAlignment(undefined); }}
        onCloseThread={() => { setThread(undefined); setThreadTargetMessageId(undefined); }}
      />
      {sidebarOpen ? <button type="button" className="mobile-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} /> : null}
      {isDesktop ? (
        <>
          {!leftSidebarHidden ? (
            <>
              <div style={{ width: leftSidebarWidth, minWidth: 180, maxWidth: 420, flexShrink: 0, minHeight: 0 }}>
                <Sidebar
                  className={sidebarOpen ? 'sidebar-mobile-open' : ''}
                  projects={projects}
                  selectedProjectId={selectedProjectId}
                  channels={channels}
                  agents={agents}
                  activitiesByAgent={activitiesByAgent}
                  machines={machines}
                  runtimeStatus={runtimeStatus}
                  selectedView={selectedView}
                  selectedChannel={selectedChannel}
                  selectedAgentId={selectedAgentId}
                  webVersion={{ component: 'web', version: WEB_VERSION, commit: WEB_COMMIT_SHA || undefined }}
                  hubVersion={hubVersion}
                  taskCount={tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled').length}
                  inboxCount={tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled' && (task.isBlocked || task.status === 'in_review' || task.status === 'changes_requested' || task.status === 'qa' || Boolean(task.assigneeId))).length}
                  onSelectInbox={() => { setSelectedView('inbox'); setSelectedAgentId(undefined); setThread(undefined); setThreadTargetMessageId(undefined); setGoalAlignment(undefined); }}
                  onSelectTasks={() => { setSelectedView('tasks'); setSelectedAgentId(undefined); setThread(undefined); setThreadTargetMessageId(undefined); setGoalAlignment(undefined); }}
                  onSelectKnowledge={() => { setSelectedView('knowledge'); setSelectedAgentId(undefined); setThread(undefined); setThreadTargetMessageId(undefined); setGoalAlignment(undefined); }}
                  onOpenSearch={() => setSearchOpen(true)}
                  onSelectProject={(projectId) => {
                    setSelectedProjectId(projectId);
                    setSelectedView('channel');
                    setThread(undefined);
                    setThreadTargetMessageId(undefined);
                    setTargetMessageId(undefined);
                    setSelectedAgentId(undefined);
                    setGoalDraft(undefined);
                    setGoalAlignment(undefined);
                    setRightPanel(undefined);
                  }}
                  onSelectChannel={(id) => {
                    setSelectedView('channel');
                    setSelectedChannel(id);
                    setSelectedAgentId(undefined);
                    setThread(undefined);
                    setGoalDraft(undefined);
                    setGoalAlignment(undefined);
                    setTargetMessageId(undefined);
                    setThreadTargetMessageId(undefined);
                  }}
                  onCreateChannel={handleCreateChannel}
                  onDeleteChannel={handleDeleteChannel}
                  onSelectAgent={handleOpenAgent}
                  onOpenAgents={() => { setRightPanel((current) => current === 'agents' ? undefined : 'agents'); setRightSidebarHidden(false); setSelectedAgentId(undefined); setThread(undefined); setThreadTargetMessageId(undefined); setGoalDraft(undefined); setGoalAlignment(undefined); }}
                  onToggleSidebar={() => setLeftSidebarHidden((current) => !current)}
                  onSignOut={handleSignOut}
                />
              </div>
              <div className="pane-resize-handle pane-resize-handle-left" onMouseDown={startResize('left')} />
            </>
          ) : (
            <button
              className="side-toggle side-toggle-left"
              onClick={() => setLeftSidebarHidden(false)}
              title="Show sidebar"
              aria-label="Show sidebar"
            >
              ▶ NAV
            </button>
          )}
        </>
      ) : (
        <Sidebar
          className={sidebarOpen ? 'sidebar-mobile-open' : ''}
          projects={projects}
          selectedProjectId={selectedProjectId}
          channels={channels}
          agents={agents}
          activitiesByAgent={activitiesByAgent}
          machines={machines}
          runtimeStatus={runtimeStatus}
          selectedView={selectedView}
          selectedChannel={selectedChannel}
          selectedAgentId={selectedAgentId}
          webVersion={{ component: 'web', version: WEB_VERSION, commit: WEB_COMMIT_SHA || undefined }}
          hubVersion={hubVersion}
          taskCount={tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled').length}
          inboxCount={tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled' && (task.isBlocked || task.status === 'in_review' || task.status === 'changes_requested' || task.status === 'qa' || Boolean(task.assigneeId))).length}
          onSelectInbox={() => { setSelectedView('inbox'); setSelectedAgentId(undefined); setThread(undefined); setThreadTargetMessageId(undefined); setGoalAlignment(undefined); }}
          onSelectTasks={() => { setSelectedView('tasks'); setSelectedAgentId(undefined); setThread(undefined); setThreadTargetMessageId(undefined); setGoalAlignment(undefined); }}
          onSelectKnowledge={() => { setSelectedView('knowledge'); setSelectedAgentId(undefined); setThread(undefined); setThreadTargetMessageId(undefined); setGoalAlignment(undefined); }}
          onOpenSearch={() => setSearchOpen(true)}
          onSelectProject={(projectId) => {
            setSelectedProjectId(projectId);
            setSelectedView('channel');
            setThread(undefined);
            setThreadTargetMessageId(undefined);
            setTargetMessageId(undefined);
            setSelectedAgentId(undefined);
            setGoalDraft(undefined);
            setGoalAlignment(undefined);
            setRightPanel(undefined);
          }}
          onSelectChannel={(id) => {
            setSelectedView('channel');
            setSelectedChannel(id);
            setSelectedAgentId(undefined);
            setThread(undefined);
            setGoalDraft(undefined);
            setGoalAlignment(undefined);
            setTargetMessageId(undefined);
            setThreadTargetMessageId(undefined);
          }}
          onCreateChannel={handleCreateChannel}
          onDeleteChannel={handleDeleteChannel}
          onSelectAgent={handleOpenAgent}
          onOpenAgents={() => { setRightPanel((current) => current === 'agents' ? undefined : 'agents'); setRightSidebarHidden(false); setSelectedAgentId(undefined); setThread(undefined); setThreadTargetMessageId(undefined); setGoalDraft(undefined); setGoalAlignment(undefined); }}
          onToggleSidebar={() => setLeftSidebarHidden((current) => !current)}
          onNavigate={() => setSidebarOpen(false)}
          onSignOut={handleSignOut}
        />
      )}
      <div className="main-pane" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {selectedView === 'inbox' ? (
          <InboxPanel tasks={tasks} channels={channels} agents={agents} />
        ) : selectedView === 'tasks' ? (
          <TaskBoard
            projectId={selectedProjectId}
            tasks={tasks}
            channels={channels}
            agents={agents}
            plans={plans}
            approvals={approvals}
            onTaskUpdated={upsertTask}
            onTaskDeleted={(taskId) => setTasks((prev) => prev.filter((task) => task.id !== taskId))}
          />
        ) : selectedView === 'knowledge' ? (
          <KnowledgePanel projectId={selectedProjectId} />
        ) : (
          <>
            <ChannelView
              channelId={selectedChannel}
              channelName={selectedChannelObj?.name ?? selectedChannel}
              messages={currentMessages}
              agents={agents}
              activitiesByAgent={activitiesByAgent}
              targetMessageId={targetMessageId}
              onCreateTask={handleMessageToTask}
              onCreateGoal={handleMessageToGoal}
              onOpenThread={handleOpenThread}
              onOpenAgent={handleOpenAgent}
              onTargetMessageSettled={() => setTargetMessageId(undefined)}
            />
            <Composer
              agents={agents}
              channelName={selectedChannelObj?.name ?? selectedChannel}
              sendBehavior={sendBehavior}
              onSendBehaviorChange={setSendBehavior}
              queueStateByAgent={queueStateByAgent}
              content={draftsByChannel[selectedChannel] ?? ''}
              onChange={(content) => {
                setDraftsByChannel((prev) => content ? { ...prev, [selectedChannel]: content } : omitKey(prev, selectedChannel));
              }}
              onSend={handleSend}
            />
          </>
        )}
      </div>
      {isDesktop ? (
        <>
          {hasRightPane ? (
            rightSidebarHidden ? (
              <button
                className="side-toggle side-toggle-right"
                onClick={() => setRightSidebarHidden(false)}
                title="Show details panel"
                aria-label="Show details panel"
              >
                THREAD ◀
              </button>
            ) : (
              <>
                <div className="pane-resize-handle pane-resize-handle-right" onMouseDown={startResize('right')} />
                <div style={{ width: rightSidebarWidth, minWidth: 260, maxWidth: 620, flexShrink: 0, minHeight: 0, display: 'flex' }}>
                  {rightPaneContent}
                </div>
              </>
            )
          ) : (
            <button
              className="right-rail-trigger"
              onClick={() => { setRightPanel('agents'); setRightSidebarHidden(false); }}
              title="Open agents"
              aria-label="Open agents"
            >
              AGENTS
            </button>
          )}
          
        </>
      ) : (
        hasRightPane ? rightPaneContent : (
          <button
            className="right-rail-trigger"
            onClick={() => { setRightPanel('agents'); setRightSidebarHidden(false); }}
            title="Open agents"
            aria-label="Open agents"
          >
            AGENTS
          </button>
        )
      )}
      {searchOpen ? (
        <SearchOverlay
          projectId={selectedProjectId}
          onClose={() => setSearchOpen(false)}
          onSelect={handleSearchSelect}
        />
      ) : null}
    </div>
  );
}

function SearchOverlay({ projectId, onClose, onSelect }: { projectId: string; onClose: () => void; onSelect: (result: SearchMessageResult) => void | Promise<void> }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchMessageResult[]>([]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      searchMessages(trimmed, 20, projectId).then((data) => setResults(data.messages)).catch(() => setResults([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [projectId, query]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'start center', paddingTop: 80, zIndex: 10 }}>
      <div style={{ width: 'min(720px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 120px)', overflow: 'auto', background: '#fafaf5', border: '3px solid #000', fontFamily: "'Courier New', monospace" }}>
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search messages" style={{ width: '100%', boxSizing: 'border-box', border: 'none', borderBottom: '3px solid #000', padding: 14, fontSize: 18, fontFamily: "'Courier New', monospace", fontWeight: 700 }} />
        <div style={{ padding: 10, display: 'grid', gap: 8 }}>
          {results.length === 0 ? <div style={{ border: '2px dashed #999', padding: 18, textAlign: 'center', fontSize: 12 }}>[ NO RESULTS ]</div> : null}
          {results.map((result) => (
            <button key={result.id} onClick={() => onSelect(result)} style={{ border: '2px solid #000', background: '#fff', padding: 10, textAlign: 'left', fontFamily: "'Courier New', monospace", cursor: 'pointer' }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>#{result.channelName} / {new Date(result.createdAt).toLocaleString()}</div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{highlightText(result.content, query)}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function highlightText(text: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return text;
  const index = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark style={{ background: '#FFD700', color: '#000' }}>{text.slice(index, index + trimmed.length)}</mark>
      {text.slice(index + trimmed.length)}
    </>
  );
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function parseQueueState(detail: string): { depth: number; processing: boolean } | undefined {
  const matched = detail.match(/^queue:depth:(\d+);processing:(0|1)$/);
  if (!matched) return undefined;
  return {
    depth: Number(matched[1]),
    processing: matched[2] === '1',
  };
}

function readStoredNumber(key: string, fallback: number, min: number, max: number): number {
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const raw = window.localStorage.getItem(key);
  if (raw === '1') return true;
  if (raw === '0') return false;
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isDesktopViewport(): boolean {
  if (typeof window === 'undefined') return true;
  if (typeof window.matchMedia !== 'function') {
    return window.innerWidth >= 1024;
  }
  return window.matchMedia('(min-width: 1024px)').matches;
}

function readLastPage(): StoredPage {
  const fallback: StoredPage = { selectedView: 'channel', selectedChannel: 'general' };
  const stored = window.localStorage.getItem(LAST_PAGE_KEY);
  if (!stored) return fallback;

  if (stored === '/tasks') return { ...fallback, selectedView: 'tasks' };
  if (stored === '/inbox') return { ...fallback, selectedView: 'inbox' };
  if (stored === '/knowledge') return { ...fallback, selectedView: 'knowledge' };
  if (stored === '/agents') return { ...fallback, rightPanel: 'agents' };

  const channel = stored.match(/^\/channels\/([^/]+)$/);
  if (channel?.[1]) {
    return { selectedView: 'channel', selectedChannel: decodeURIComponent(channel[1]) };
  }

  const agent = stored.match(/^\/agents\/([^/]+)$/);
  if (agent?.[1]) {
    return { ...fallback, selectedAgentId: decodeURIComponent(agent[1]) };
  }

  return fallback;
}

function readProjectSlugFromPath(): string | undefined {
  const trimmed = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (!trimmed) return undefined;
  const [slug] = trimmed.split('/');
  return slug || undefined;
}

function writeLastPage(page: StoredPage) {
  window.localStorage.setItem(LAST_PAGE_KEY, pageToPath(page));
}

function pageToPath({ selectedView, selectedChannel, selectedAgentId, rightPanel }: StoredPage) {
  if (rightPanel === 'agents') return '/agents';
  if (selectedAgentId) return `/agents/${encodeURIComponent(selectedAgentId)}`;
  if (selectedView === 'tasks') return '/tasks';
  if (selectedView === 'inbox') return '/inbox';
  if (selectedView === 'knowledge') return '/knowledge';
  return `/channels/${encodeURIComponent(selectedChannel)}`;
}
