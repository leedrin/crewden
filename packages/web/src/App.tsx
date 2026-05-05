import { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { ChannelView } from './components/ChannelView.js';
import { Composer } from './components/Composer.js';
import { AgentPanel } from './components/AgentPanel.js';
import { AgentDetailPanel } from './components/AgentDetailPanel.js';
import { TaskBoard } from './components/TaskBoard.js';
import { ThreadPanel } from './components/ThreadPanel.js';
import { GoalDraftPanel } from './components/GoalDraftPanel.js';
import { GoalAlignmentPanel } from './components/GoalAlignmentPanel.js';
import { KnowledgePanel } from './components/KnowledgePanel.js';
import { MobileTopBar } from './components/MobileTopBar.js';
import { LoginView } from './components/LoginView.js';
import type { Channel, Message, MessageThread, Agent, Machine, AgentActivity, VersionInfo, Task, Reminder, SearchMessageResult, GoalBrief, GoalAlignment, RuntimeStatus } from './api.js';
import { AuthError, WEB_COMMIT_SHA, WEB_VERSION, buildWsUrl, getChannels, getMessages, getMessageThread, sendMessage, getAgents, getMachines, getAgentActivities, getHubVersion, getTasks, messageToTask, startGoalAlignment, getAgentReminders, createChannel, deleteChannel, searchMessages, setAuthFailureHandler, verifyAuthToken, getRuntimeStatus } from './api.js';
import { clearStoredAuthToken, getEffectiveAuthToken, markSignedOut, setStoredAuthToken } from './auth.js';
import { notifyBrowser, requestPermission } from './notifications.js';

const LAST_PAGE_KEY = 'crewden_last_page';

type MainView = 'channel' | 'tasks' | 'knowledge';
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
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messagesByChannel, setMessagesByChannel] = useState<Record<string, Message[]>>({});
  const [draftsByChannel, setDraftsByChannel] = useState<Record<string, string>>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
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
  const wsRef = useRef<WebSocket | null>(null);
  const selectedChannelRef = useRef(selectedChannel);
  const isAuthenticated = authState === 'authenticated';

  const resetWorkspaceState = useCallback(() => {
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

  const loadChannels = useCallback(async () => {
    const data = await getChannels();
    setChannels(data);
  }, []);

  const loadMessages = useCallback(async (channelId: string) => {
    const data = await getMessages(channelId);
    setMessagesByChannel((prev) => ({ ...prev, [channelId]: data }));
  }, []);

  const loadAgents = useCallback(async () => {
    const data = await getAgents();
    setAgents(data);
  }, []);

  const loadMachines = useCallback(async () => {
    const data = await getMachines();
    setMachines(data);
  }, []);

  const loadTasks = useCallback(async () => {
    const data = await getTasks();
    setTasks(data);
  }, []);

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
    loadChannels();
    loadAgents();
    loadMachines();
    loadTasks();
    loadRuntimeStatus();
    getHubVersion().then(setHubVersion).catch(() => undefined);
    requestPermission().catch(() => undefined);
  }, [isAuthenticated, loadAgents, loadChannels, loadMachines, loadRuntimeStatus, loadTasks]);

  useEffect(() => {
    if (!isAuthenticated) return;
    writeLastPage({ selectedView, selectedChannel, selectedAgentId, rightPanel });
  }, [isAuthenticated, rightPanel, selectedAgentId, selectedChannel, selectedView]);

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
          updateThreadRoot(msg.root);
          setThread((current) => {
            if (!current || current.root.id !== msg.root.id) return current;
            const replies = current.replies.some((reply) => reply.id === msg.message.id)
              ? current.replies.map((reply) => (reply.id === msg.message.id ? msg.message : reply))
              : [...current.replies, msg.message];
            return { root: msg.root, replies };
          });
          const replySender: string = msg.message.senderName ?? msg.message.agentId ?? 'Someone';
          notifyBrowser(
            `${replySender} replied in thread`,
            { body: msg.message.content?.slice(0, 80), tag: `thread:${msg.message.id}` },
            'messages',
          );
        } else if (msg.type === 'agent:update' || msg.type === 'agent:updated') {
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
          setTasks((prev) => {
            const exists = prev.find((task) => task.id === msg.task.id);
            if (exists) return prev.map((task) => (task.id === msg.task.id ? msg.task : task));
            return [...prev, msg.task];
          });
          const taskStatus: string = msg.task.status;
          if (taskStatus === 'done' || taskStatus === 'blocked' || taskStatus === 'in_review') {
            const statusLabel: Record<string, string> = { done: 'Done', blocked: 'Blocked', in_review: 'Needs review' };
            notifyBrowser(
              `Task ${statusLabel[taskStatus] ?? taskStatus}`,
              { body: msg.task.title?.slice(0, 80), tag: `task:${msg.task.id}:${taskStatus}` },
              'tasks',
            );
          }
        } else if (msg.type === 'goal:update') {
          setGoalDraft((current) => current?.id === msg.goal.id ? msg.goal : current);
        } else if (msg.type === 'goal-alignment:update') {
          setGoalAlignment((current) => current?.id === msg.alignment.id ? msg.alignment : current);
        } else if (msg.type === 'channel:created') {
          setChannels((prev) => prev.some((channel) => channel.id === msg.channel.id) ? prev : [...prev, msg.channel]);
        } else if (msg.type === 'channel:deleted') {
          setChannels((prev) => prev.filter((channel) => channel.id !== msg.channelId));
          if (selectedChannelRef.current === msg.channelId) setSelectedChannel('general');
        } else if (msg.type === 'reminder:update') {
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
  }, [handleAuthExpired, isAuthenticated, loadAgents, loadChannels, loadMachines, loadMessages, loadRuntimeStatus, loadTasks, updateThreadRoot, upsertMessage]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = setInterval(() => {
      loadRuntimeStatus().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [isAuthenticated, loadRuntimeStatus]);

  const handleSend = async (content: string, agentId?: string) => {
    const channelId = selectedChannel;
    const message = await sendMessage(channelId, 'user', content, agentId);
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
    setThreadTargetMessageId(undefined);
    setRightPanel(undefined);
    setSelectedAgentId(undefined);
    setGoalDraft(undefined);
    setGoalAlignment(undefined);
    setThread(await getMessageThread(rootId));
  };

  const handleOpenAgent = (agentId: string) => {
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
    const reply = await sendMessage(thread.root.channelId, 'user', content, agentId, thread.root.id);
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
    setGoalAlignment(alignment);
    setThread(await getMessageThread(alignment.threadRootId));
    setGoalDraft(undefined);
    setSelectedView('channel');
    setSelectedAgentId(undefined);
    setRightPanel(undefined);
  };

  const handleCreateChannel = async (name: string) => {
    const channel = await createChannel(name);
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
    : selectedView === 'knowledge'
      ? 'Knowledge'
    : selectedAgent
      ? selectedAgent.displayName ?? selectedAgent.name
      : `# ${selectedChannelObj?.name ?? selectedChannel}`;

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
        subtitle={thread ? 'Thread' : selectedView === 'tasks' ? `${tasks.filter((task) => task.status !== 'done').length} open` : selectedView === 'knowledge' ? 'Memory layer' : 'Workspace'}
        hasThread={!!thread}
        onOpenMenu={() => setSidebarOpen(true)}
        onOpenAgents={() => { setRightPanel('agents'); setSelectedAgentId(undefined); setThread(undefined); setThreadTargetMessageId(undefined); setGoalAlignment(undefined); }}
        onCloseThread={() => { setThread(undefined); setThreadTargetMessageId(undefined); }}
      />
      {sidebarOpen ? <button type="button" className="mobile-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} /> : null}
      <Sidebar
        className={sidebarOpen ? 'sidebar-mobile-open' : ''}
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
        taskCount={tasks.filter((task) => task.status !== 'done').length}
        onSelectTasks={() => { setSelectedView('tasks'); setSelectedAgentId(undefined); setThread(undefined); setThreadTargetMessageId(undefined); setGoalAlignment(undefined); }}
        onSelectKnowledge={() => { setSelectedView('knowledge'); setSelectedAgentId(undefined); setThread(undefined); setThreadTargetMessageId(undefined); setGoalAlignment(undefined); }}
        onOpenSearch={() => setSearchOpen(true)}
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
        onOpenAgents={() => { setRightPanel((current) => current === 'agents' ? undefined : 'agents'); setSelectedAgentId(undefined); setThread(undefined); setThreadTargetMessageId(undefined); setGoalDraft(undefined); setGoalAlignment(undefined); }}
        onNavigate={() => setSidebarOpen(false)}
        onSignOut={handleSignOut}
      />
      <div className="main-pane" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {selectedView === 'tasks' ? (
          <TaskBoard
            tasks={tasks}
            channels={channels}
            agents={agents}
            onTaskUpdated={upsertTask}
            onTaskDeleted={(taskId) => setTasks((prev) => prev.filter((task) => task.id !== taskId))}
          />
        ) : selectedView === 'knowledge' ? (
          <KnowledgePanel />
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
              content={draftsByChannel[selectedChannel] ?? ''}
              onChange={(content) => {
                setDraftsByChannel((prev) => content ? { ...prev, [selectedChannel]: content } : omitKey(prev, selectedChannel));
              }}
              onSend={handleSend}
            />
          </>
        )}
      </div>
      {goalAlignment ? (
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
          agents={agents}
          activitiesByAgent={activitiesByAgent}
          targetMessageId={threadTargetMessageId}
          onClose={() => { setThread(undefined); setThreadTargetMessageId(undefined); }}
          onSend={handleThreadSend}
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
          onClose={() => setSelectedAgentId(undefined)}
        />
      ) : rightPanel === 'agents' ? (
        <AgentPanel
          agents={agents}
          machines={machines}
          runtimeStatus={runtimeStatus}
          onAgentsChange={loadAgents}
          onRuntimeStatusRefresh={loadRuntimeStatus}
          onClose={() => setRightPanel(undefined)}
        />
      ) : (
        <button
          className="right-rail-trigger"
          onClick={() => setRightPanel('agents')}
          title="Open agents"
          aria-label="Open agents"
        >
          AGENTS
        </button>
      )}
      {searchOpen ? (
        <SearchOverlay
          onClose={() => setSearchOpen(false)}
          onSelect={handleSearchSelect}
        />
      ) : null}
    </div>
  );
}

function SearchOverlay({ onClose, onSelect }: { onClose: () => void; onSelect: (result: SearchMessageResult) => void | Promise<void> }) {
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
      searchMessages(trimmed, 20).then((data) => setResults(data.messages)).catch(() => setResults([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

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

function readLastPage(): StoredPage {
  const fallback: StoredPage = { selectedView: 'channel', selectedChannel: 'general' };
  const stored = window.localStorage.getItem(LAST_PAGE_KEY);
  if (!stored) return fallback;

  if (stored === '/tasks') return { ...fallback, selectedView: 'tasks' };
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

function writeLastPage(page: StoredPage) {
  window.localStorage.setItem(LAST_PAGE_KEY, pageToPath(page));
}

function pageToPath({ selectedView, selectedChannel, selectedAgentId, rightPanel }: StoredPage) {
  if (rightPanel === 'agents') return '/agents';
  if (selectedAgentId) return `/agents/${encodeURIComponent(selectedAgentId)}`;
  if (selectedView === 'tasks') return '/tasks';
  if (selectedView === 'knowledge') return '/knowledge';
  return `/channels/${encodeURIComponent(selectedChannel)}`;
}
