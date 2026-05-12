import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import * as api from '../src/api.js';

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    class MockWebSocket {
      static OPEN = 1;
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() {
        setTimeout(() => this.onopen?.(), 0);
      }
      send = vi.fn();
      close = vi.fn(() => this.onclose?.());
    }
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  it('keeps the agent panel collapsed until explicitly opened', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Workspace').length).toBeGreaterThan(0);
    });

    expect(screen.queryByText('+ NEW')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Open agents' })[0]);

    await waitFor(() => {
      expect(screen.getByText('+ NEW')).toBeTruthy();
    });
  });

  it('opens the mobile navigation drawer from the top bar', async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Workspace').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(container.querySelector('.sidebar-mobile-open')).toBeTruthy();
  });

  it('persists the last page as users navigate major sections', async () => {
    vi.mocked(api.getChannels).mockResolvedValue([
      { id: 'general', name: 'general', createdAt: '2026-04-25T00:00:00.000Z' },
      { id: 'random', name: 'random', createdAt: '2026-04-25T00:00:00.000Z' },
    ]);
    vi.mocked(api.getAgents).mockResolvedValue([{
      id: 'agent-1',
      name: 'engineer',
      displayName: 'Engineer',
      runtime: 'codex',
      status: 'idle',
      createdAt: '2026-04-25T00:00:00.000Z',
    }]);

    render(<App />);

    await screen.findByPlaceholderText('Message #general');
    await waitFor(() => {
      expect(window.localStorage.getItem('crewden_last_page')).toBe('/channels/general');
    });

    fireEvent.click(screen.getByRole('button', { name: /random/ }));
    await waitFor(() => {
      expect(window.localStorage.getItem('crewden_last_page')).toBe('/channels/random');
    });

    fireEvent.click(screen.getByText('Tasks'));
    await waitFor(() => {
      expect(window.localStorage.getItem('crewden_last_page')).toBe('/tasks');
    });

    fireEvent.click(screen.getByText('Knowledge'));
    await waitFor(() => {
      expect(window.localStorage.getItem('crewden_last_page')).toBe('/knowledge');
    });

    fireEvent.click(screen.getAllByText('Engineer')[0]);
    await waitFor(() => {
      expect(window.localStorage.getItem('crewden_last_page')).toBe('/agents/agent-1');
      expect(screen.getByText('WORK SUMMARY')).toBeTruthy();
    });
  });

  it('restores the last page from localStorage on startup', async () => {
    vi.mocked(api.getChannels).mockResolvedValue([
      { id: 'general', name: 'general', createdAt: '2026-04-25T00:00:00.000Z' },
      { id: 'random', name: 'random', createdAt: '2026-04-25T00:00:00.000Z' },
    ]);
    vi.mocked(api.getAgents).mockResolvedValue([{
      id: 'agent-1',
      name: 'engineer',
      displayName: 'Engineer',
      runtime: 'codex',
      status: 'idle',
      createdAt: '2026-04-25T00:00:00.000Z',
    }]);

    window.localStorage.setItem('crewden_last_page', '/channels/random');
    render(<App />);
    expect(await screen.findByPlaceholderText('Message #random')).toBeTruthy();

    cleanup();
    window.localStorage.setItem('crewden_last_page', '/tasks');
    render(<App />);
    expect(await screen.findByText('TASKS')).toBeTruthy();

    cleanup();
    window.localStorage.setItem('crewden_last_page', '/knowledge');
    render(<App />);
    expect(await screen.findByText('Memory layer')).toBeTruthy();

    cleanup();
    window.localStorage.setItem('crewden_last_page', '/agents/agent-1');
    render(<App />);
    expect(await screen.findByText('WORK SUMMARY')).toBeTruthy();
  });

  it('keeps channel drafts by channel and clears them after a successful send', async () => {
    vi.mocked(api.getChannels).mockResolvedValue([
      { id: 'general', name: 'general', createdAt: '2026-04-25T00:00:00.000Z' },
      { id: 'random', name: 'random', createdAt: '2026-04-25T00:00:00.000Z' },
    ]);
    vi.mocked(api.sendMessage).mockResolvedValueOnce({
      id: 'msg-random',
      channelId: 'random',
      senderName: 'user',
      content: 'random draft',
      actorType: 'human',
      actorId: 'user',
      createdAt: '2026-04-25T00:00:01.000Z',
    });

    render(<App />);

    const generalComposer = await screen.findByPlaceholderText('Message #general');
    fireEvent.change(generalComposer, { target: { value: 'general draft' } });

    fireEvent.click(screen.getByText('Knowledge'));
    fireEvent.click(screen.getByRole('button', { name: /general/ }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Message #general')).toHaveValue('general draft');
    });

    fireEvent.click(screen.getByRole('button', { name: /random/ }));
    fireEvent.change(await screen.findByPlaceholderText('Message #random'), { target: { value: 'random draft' } });

    fireEvent.click(screen.getByRole('button', { name: /general/ }));
    expect(await screen.findByPlaceholderText('Message #general')).toHaveValue('general draft');

    fireEvent.click(screen.getByRole('button', { name: /random/ }));
    expect(await screen.findByPlaceholderText('Message #random')).toHaveValue('random draft');

    fireEvent.click(screen.getByText(/Send/));

    await waitFor(() => {
      expect(api.sendMessage).toHaveBeenCalledWith('random', 'user', 'random draft', undefined, undefined, 'interrupt');
      expect(screen.getByPlaceholderText('Message #random')).toHaveValue('');
    });

    fireEvent.click(screen.getByRole('button', { name: /general/ }));
    expect(await screen.findByPlaceholderText('Message #general')).toHaveValue('general draft');
  });

  it('highlights channel mentions and distinguishes mentions of the current user', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([]);
    vi.mocked(api.getMessages).mockResolvedValue([
      {
        id: 'msg-mention',
        channelId: 'general',
        senderName: 'Engineer',
        content: 'Ping @Engineer and @user',
        actorType: 'human',
        actorId: 'Engineer',
        createdAt: '2026-04-25T00:00:00.000Z',
      },
      {
        id: 'msg-plain',
        channelId: 'general',
        senderName: 'Engineer',
        content: 'Plain status update',
        actorType: 'human',
        actorId: 'Engineer',
        createdAt: '2026-04-25T00:01:00.000Z',
      },
    ]);

    render(<App />);

    expect(await screen.findByText('@Engineer')).toHaveStyle({
      background: '#fff3a3',
      fontWeight: '700',
    });
    expect(screen.getByText('@user')).toHaveStyle({
      background: '#dbeafe',
      border: '1px solid #0b63ce',
      fontWeight: '700',
    });
    expect(screen.getByText('Plain status update')).toBeTruthy();
  });

  it('clears the thread panel when selecting an agent from the sidebar', async () => {
    vi.mocked(api.getMessages).mockResolvedValue([{
      id: 'msg-thread',
      channelId: 'general',
      senderName: 'user',
      content: 'Investigate the agent panel priority',
      actorType: 'human',
      actorId: 'user',
      replyCount: 1,
      createdAt: '2026-04-25T00:00:00.000Z',
    }]);
    vi.mocked(api.getMessageThread).mockResolvedValueOnce({
      root: {
        id: 'msg-thread',
        channelId: 'general',
        senderName: 'user',
        content: 'Investigate the agent panel priority',
        actorType: 'human',
        actorId: 'user',
        replyCount: 1,
        createdAt: '2026-04-25T00:00:00.000Z',
      },
      replies: [{
        id: 'msg-reply',
        channelId: 'general',
        senderName: 'Engineer',
        content: 'Opened a thread reply.',
        actorType: 'agent',
        actorId: 'agent-thread',
        agentId: 'agent-thread',
        threadRootId: 'msg-thread',
        createdAt: '2026-04-25T00:01:00.000Z',
      }],
    });
    vi.mocked(api.getAgents).mockResolvedValue([{
      id: 'agent-thread',
      name: 'engineer',
      displayName: 'Engineer',
      runtime: 'codex',
      status: 'idle',
      createdAt: '2026-04-25T00:00:00.000Z',
    }]);

    render(<App />);

    fireEvent.click(await screen.findByTitle('Reply in thread'));
    await screen.findByRole('button', { name: 'Close' });

    fireEvent.click(screen.getAllByText('Engineer')[0]);

    await waitFor(() => {
      expect(screen.getByText('WORK SUMMARY')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    });
  });

  it('shows the bound machine name and id in the agent detail profile', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([{
      id: 'agent-1',
      name: 'engineer',
      displayName: 'Engineer',
      runtime: 'codex',
      status: 'idle',
      machineId: 'machine-1',
      createdAt: '2026-04-25T00:00:00.000Z',
    }]);
    vi.mocked(api.getMachines).mockResolvedValue([{
      id: 'machine-1',
      hostname: 'DevBook',
      os: 'darwin',
      runtimes: ['codex'],
      status: 'online',
      connectedAt: '2026-04-25T00:00:00.000Z',
    }]);

    render(<App />);

    fireEvent.click((await screen.findAllByText('Engineer'))[0]);

    await waitFor(() => {
      expect(screen.getByText('DevBook (machine-1)')).toBeTruthy();
    });
  });

  it('falls back to the machine id when the machine name is unavailable', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([{
      id: 'agent-1',
      name: 'engineer',
      displayName: 'Engineer',
      runtime: 'codex',
      status: 'idle',
      machineId: 'machine-missing',
      createdAt: '2026-04-25T00:00:00.000Z',
    }]);
    vi.mocked(api.getMachines).mockResolvedValue([]);

    render(<App />);

    fireEvent.click((await screen.findAllByText('Engineer'))[0]);

    await waitFor(() => {
      expect(screen.getByText('machine-missing')).toBeTruthy();
    });
  });

  it('shows DM participants by display name and falls back to ids', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([
      {
        id: 'agent-1',
        name: 'engineer',
        displayName: 'Engineer',
        runtime: 'codex',
        status: 'idle',
        createdAt: '2026-04-25T00:00:00.000Z',
      },
      {
        id: 'agent-2',
        name: 'designer',
        displayName: 'Designer',
        runtime: 'codex',
        status: 'idle',
        createdAt: '2026-04-25T00:00:00.000Z',
      },
    ]);
    vi.mocked(api.getAgentDmThreads).mockResolvedValue([
      {
        otherAgentId: 'user',
        lastMessage: {
          id: 'dm-user',
          fromAgentId: 'user',
          toAgentId: 'agent-1',
          content: 'hello from user',
          createdAt: '2026-04-25T00:00:00.000Z',
        },
      },
      {
        otherAgentId: 'agent-2',
        lastMessage: {
          id: 'dm-agent',
          fromAgentId: 'agent-2',
          toAgentId: 'agent-1',
          content: 'hello from agent',
          createdAt: '2026-04-25T00:01:00.000Z',
        },
      },
      {
        otherAgentId: 'agent-missing',
        lastMessage: {
          id: 'dm-missing',
          fromAgentId: 'agent-missing',
          toAgentId: 'agent-1',
          content: 'hello from missing',
          createdAt: '2026-04-25T00:02:00.000Z',
        },
      },
    ]);
    vi.mocked(api.getAgentDirectMessages).mockImplementation(async (_agentId, otherId) => [{
      id: `message-${otherId}`,
      fromAgentId: otherId,
      toAgentId: 'agent-1',
      content: `message from ${otherId}`,
      createdAt: '2026-04-25T00:03:00.000Z',
    }]);

    render(<App />);

    fireEvent.click((await screen.findAllByText('Engineer'))[0]);
    fireEvent.click(screen.getByText('DMS'));

    await waitFor(() => {
      expect(api.getAgentDmThreads).toHaveBeenCalledWith('agent-1');
      expect(screen.getAllByText('User').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Designer').length).toBeGreaterThan(0);
      expect(screen.getAllByText('agent-missing').length).toBeGreaterThan(0);
      expect(screen.queryByText('Unknown agent')).toBeNull();
    });

    fireEvent.change(screen.getByLabelText('DM recipient'), { target: { value: 'agent-2' } });
    await waitFor(() => {
      expect(api.getAgentDirectMessages).toHaveBeenCalledWith('agent-1', 'agent-2');
      expect(screen.getByText('message from agent-2')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('DM recipient'), { target: { value: 'agent-missing' } });
    await waitFor(() => {
      expect(api.getAgentDirectMessages).toHaveBeenCalledWith('agent-1', 'agent-missing');
      expect(screen.getByText('message from agent-missing')).toBeTruthy();
    });
  });

  it('lets a user align a goal in chat and confirm contextual tasks', async () => {
    vi.mocked(api.getMessages).mockResolvedValue([
      {
        id: 'msg-1',
        channelId: 'general',
        senderName: 'user',
        content: 'Help me ship a Mac voice input MVP',
        actorType: 'human',
        actorId: 'user',
        createdAt: '2026-04-25T00:00:00.000Z',
      },
    ]);
    vi.mocked(api.getMessageThread).mockResolvedValueOnce({
      root: {
        id: 'msg-1',
        channelId: 'general',
        senderName: 'user',
        content: 'Help me ship a Mac voice input MVP',
        actorType: 'human',
        actorId: 'user',
        createdAt: '2026-04-25T00:00:00.000Z',
      },
      replies: [],
    });
    vi.mocked(api.startGoalAlignment).mockResolvedValueOnce({
      id: 'alignment-1',
      channelId: 'general',
      threadRootId: 'msg-1',
      sourceMessageId: 'msg-1',
      status: 'needs_clarification',
      objective: 'Help me ship a Mac voice input MVP',
      questions: ['What does success look like for this goal?'],
      answers: [],
      successCriteria: ['MVP plan is actionable'],
      constraints: [],
      planSummary: 'Draft plan for a Mac voice input MVP.',
      taskDrafts: [{ title: 'Plan: Help me ship a Mac voice input MVP', role: 'owner', acceptanceCriteria: ['MVP plan is actionable'] }],
      recommendedAgentIds: [],
      reviewerAgentIds: [],
      recommendationReasons: {},
      gaps: ['No owner agent matched product/planning or engineering responsibilities.'],
      riskLevel: 'low',
      createdAt: '2026-04-25T00:00:01.000Z',
      updatedAt: '2026-04-25T00:00:01.000Z',
    });
    vi.mocked(api.patchGoalAlignment).mockResolvedValueOnce({
      id: 'alignment-1',
      channelId: 'general',
      threadRootId: 'msg-1',
      sourceMessageId: 'msg-1',
      status: 'awaiting_confirmation',
      objective: 'Help me ship a Mac voice input MVP',
      questions: ['What does success look like for this goal?'],
      answers: ['MVP should be actionable'],
      successCriteria: ['MVP plan is actionable'],
      constraints: [],
      planSummary: 'Draft plan for a Mac voice input MVP.',
      taskDrafts: [{ title: 'Plan: Help me ship a Mac voice input MVP', role: 'owner', acceptanceCriteria: ['MVP plan is actionable'] }],
      recommendedAgentIds: [],
      reviewerAgentIds: [],
      recommendationReasons: {},
      gaps: [],
      riskLevel: 'low',
      createdAt: '2026-04-25T00:00:01.000Z',
      updatedAt: '2026-04-25T00:00:02.000Z',
    });
    vi.mocked(api.confirmGoalAlignment).mockResolvedValueOnce({
      alignment: {
        id: 'alignment-1',
        channelId: 'general',
        threadRootId: 'msg-1',
        sourceMessageId: 'msg-1',
        goalId: 'goal-1',
        status: 'confirmed',
        objective: 'Help me ship a Mac voice input MVP',
        questions: [],
        answers: ['MVP should be actionable'],
        successCriteria: ['MVP plan is actionable'],
        constraints: [],
        planSummary: 'Draft plan for a Mac voice input MVP.',
        taskDrafts: [],
        recommendedAgentIds: [],
        reviewerAgentIds: [],
        recommendationReasons: {},
        gaps: [],
        riskLevel: 'low',
        createdAt: '2026-04-25T00:00:01.000Z',
        updatedAt: '2026-04-25T00:00:03.000Z',
      },
      goal: {
        id: 'goal-1',
        channelId: 'general',
        sourceMessageId: 'msg-1',
        requesterName: 'user',
        objective: 'Help me ship a Mac voice input MVP',
        background: [],
        successCriteria: ['MVP plan is actionable'],
        constraints: [],
        assumptions: [],
        risks: [],
        status: 'confirmed',
        createdAt: '2026-04-25T00:00:03.000Z',
        updatedAt: '2026-04-25T00:00:03.000Z',
      },
      tasks: [{
        id: 'task-1',
        channelId: 'general',
        messageId: 'msg-1',
        title: 'Draft MVP plan',
        status: 'backlog',
        type: 'feature',
        creatorName: 'user',
        creator: { actorType: 'human', actorId: 'user' },
        isBlocked: false,
        context: {
          goalId: 'goal-1',
          goalObjective: 'Help me ship a Mac voice input MVP',
          acceptanceCriteria: ['MVP plan is actionable'],
        },
        version: 1,
        createdAt: '2026-04-25T00:00:03.000Z',
        updatedAt: '2026-04-25T00:00:03.000Z',
      }],
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Help me ship a Mac voice input MVP')).toBeTruthy();
    });

    fireEvent.click(await screen.findByTitle('Plan goal'));

    await waitFor(() => {
      expect(screen.getByText('GOAL ALIGNMENT')).toBeTruthy();
      expect(screen.getByText(/What does success look like/)).toBeTruthy();
      expect(screen.getByText('PLAN PREVIEW')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('SUCCESS CRITERIA'), { target: { value: 'MVP plan is actionable' } });
    fireEvent.change(screen.getByLabelText('ANSWERS / CONTEXT'), { target: { value: 'MVP should be actionable' } });
    fireEvent.click(screen.getByText('REVISE'));

    await waitFor(() => {
      expect(api.patchGoalAlignment).toHaveBeenCalledWith('alignment-1', expect.objectContaining({ status: 'awaiting_confirmation' }));
    });

    fireEvent.click(screen.getByText('CONFIRM PLAN'));

    await waitFor(() => {
      expect(screen.getByText('Draft MVP plan')).toBeTruthy();
      expect(screen.getByText('GOAL: Help me ship a Mac voice input MVP')).toBeTruthy();
      expect(screen.getAllByText('MVP plan is actionable').length).toBeGreaterThan(0);
    });
  });

  it('shows blocked work on task board and agent work summary', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([{
      id: 'agent-1',
      name: 'engineer',
      displayName: 'Engineer',
      runtime: 'codex',
      status: 'idle',
      organization: { roles: ['Engineer'], capabilities: ['coding'] },
      createdAt: '2026-04-25T00:00:00.000Z',
    }]);
    vi.mocked(api.getTasks).mockResolvedValue([{
      id: 'task-1',
      channelId: 'general',
      title: 'Implement coding task',
      status: 'in_review',
      type: 'feature',
      creatorName: 'user',
      creator: { actorType: 'human', actorId: 'user' },
      assigneeId: 'agent-1',
      isBlocked: true,
      blockedReason: 'missing API token',
      context: {
        blockedReason: 'missing API token',
        blockedNeeds: 'user provides token',
        progressEvents: [{ id: 'evt-1', taskId: 'task-1', agentId: 'agent-1', type: 'blocked', detail: 'missing API token', createdAt: '2026-04-25T00:00:00.000Z' }],
      },
      version: 1,
      createdAt: '2026-04-25T00:00:00.000Z',
      updatedAt: '2026-04-25T00:00:01.000Z',
    }]);

    render(<App />);

    fireEvent.click(await screen.findByText('Tasks'));
    await waitFor(() => {
      expect(screen.getAllByText('BLOCKED').length).toBeGreaterThan(0);
      expect(screen.getByText('missing API token')).toBeTruthy();
      expect(screen.getByText('Needs: user provides token')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByText('Engineer')[0]);
    await waitFor(() => {
      expect(screen.getByText('WORK SUMMARY')).toBeTruthy();
      expect(screen.getByText('BLOCKED 1')).toBeTruthy();
    });
  });

  it('lets users edit an agent runtime from the profile panel', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([{
      id: 'agent-runtime',
      name: 'engineer',
      displayName: 'Engineer',
      runtime: 'claude',
      status: 'inactive',
      createdAt: '2026-04-25T00:00:00.000Z',
    }]);
    vi.mocked(api.patchAgent).mockResolvedValue({
      id: 'agent-runtime',
      name: 'engineer',
      displayName: 'Engineer',
      runtime: 'codex',
      status: 'inactive',
      createdAt: '2026-04-25T00:00:00.000Z',
    });

    render(<App />);

    fireEvent.click(await screen.findByText('Engineer'));
    fireEvent.change(await screen.findByLabelText('RUNTIME'), { target: { value: 'codex' } });
    fireEvent.click(screen.getByText('SAVE'));

    await waitFor(() => {
      expect(api.patchAgent).toHaveBeenCalledWith('agent-runtime', expect.objectContaining({ runtime: 'codex' }));
    });
  });

  it('lets users delete an agent from the agent panel after confirmation', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([{
      id: 'agent-delete',
      name: 'deleteme',
      displayName: 'Delete Me',
      runtime: 'codex',
      status: 'inactive',
      createdAt: '2026-04-25T00:00:00.000Z',
    }]);
    vi.mocked(api.deleteAgent).mockResolvedValue();

    render(<App />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Open agents' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'DELETE' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete agent confirmation' });
    expect(within(dialog).getByText(/This cannot be undone/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'DELETE' }));

    await waitFor(() => {
      expect(api.deleteAgent).toHaveBeenCalledWith('agent-delete');
    });
  });

  it('warns before deleting a working agent from the detail panel', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([{
      id: 'agent-working',
      name: 'worker',
      displayName: 'Worker',
      runtime: 'codex',
      status: 'working',
      createdAt: '2026-04-25T00:00:00.000Z',
    }]);
    vi.mocked(api.deleteAgent).mockRejectedValue(new Error('Cannot delete agent while it is working. Stop the agent first.'));

    render(<App />);

    fireEvent.click(await screen.findByText('Worker'));
    fireEvent.click(await screen.findByText('DELETE AGENT'));

    const dialog = await screen.findByRole('dialog', { name: 'Delete agent confirmation' });
    expect(within(dialog).getByText(/THIS AGENT IS WORKING/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'DELETE' }));

    await waitFor(() => {
      expect(within(dialog).getByText(/Stop the agent first/)).toBeTruthy();
    });
  });

  it('shows review evidence and acceptance status on the task board', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([{
      id: 'agent-qa',
      name: 'qa',
      displayName: 'QA',
      runtime: 'codex',
      status: 'idle',
      organization: { roles: ['QA'], capabilities: ['review'] },
      createdAt: '2026-04-25T00:00:00.000Z',
    }]);
    vi.mocked(api.getTasks).mockResolvedValue([{
      id: 'task-review',
      channelId: 'general',
      title: 'Ship reviewed feature',
      status: 'done',
      type: 'feature',
      creatorName: 'user',
      creator: { actorType: 'human', actorId: 'user' },
      isBlocked: false,
      context: {
        reviews: [{
          id: 'review-1',
          taskId: 'task-review',
          reviewerAgentId: 'agent-qa',
          status: 'approved',
          evidence: ['pnpm verify passed', 'web review badge visible'],
          checklist: [{ label: 'tests pass', checked: true }, { label: 'review badge visible', checked: true }],
          comment: 'verified',
          createdAt: '2026-04-25T00:00:00.000Z',
          updatedAt: '2026-04-25T00:00:01.000Z',
        }],
      },
      version: 1,
      createdAt: '2026-04-25T00:00:00.000Z',
      updatedAt: '2026-04-25T00:00:01.000Z',
    }]);

    render(<App />);

    fireEvent.click(await screen.findByText('Tasks'));
    await waitFor(() => {
      expect(screen.getByText('Ship reviewed feature')).toBeTruthy();
      expect(screen.getByText('ACCEPTED')).toBeTruthy();
      expect(screen.getByText('Status: approved')).toBeTruthy();
      expect(screen.getByText('Reviewer: @QA')).toBeTruthy();
      expect(screen.getByText('Evidence: 2')).toBeTruthy();
      expect(screen.getByText('Checklist: 2')).toBeTruthy();
    });
  });

  it('lets users search and create knowledge entries from the web UI', async () => {
    vi.mocked(api.searchKnowledge).mockResolvedValueOnce([{
      entry: {
        id: 'knowledge-1',
        kind: 'decision',
        title: 'V1 test environment',
        summary: 'Use the test Cloudflare instance.',
        body: 'Keep production isolated until V1 is accepted.',
        tags: ['v1'],
        sourceRefs: ['goal:v1'],
        status: 'active',
        createdAt: '2026-04-25T00:00:00.000Z',
        updatedAt: '2026-04-25T00:00:00.000Z',
      },
    }]);
    vi.mocked(api.createKnowledge).mockResolvedValueOnce({
      id: 'knowledge-2',
      kind: 'runbook',
      title: 'Run browser checks',
      summary: 'Use web tests for UI changes.',
      body: 'Run pnpm --filter @crewden/web test.',
      tags: ['web'],
      sourceRefs: ['task:web'],
      status: 'active',
      createdAt: '2026-04-25T00:00:01.000Z',
      updatedAt: '2026-04-25T00:00:01.000Z',
    });
    vi.mocked(api.searchKnowledge).mockResolvedValueOnce([]);

    render(<App />);

    fireEvent.click(await screen.findByText('Knowledge'));
    await waitFor(() => {
      expect(screen.getAllByText('V1 test environment').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Use the test Cloudflare instance.').length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Run browser checks' } });
    fireEvent.change(screen.getByPlaceholderText('Summary'), { target: { value: 'Use web tests for UI changes.' } });
    fireEvent.change(screen.getByPlaceholderText('Body'), { target: { value: 'Run pnpm --filter @crewden/web test.' } });
    fireEvent.change(screen.getByPlaceholderText('tags, comma separated'), { target: { value: 'web' } });
    fireEvent.change(screen.getByPlaceholderText('source refs, comma separated'), { target: { value: 'task:web' } });
    fireEvent.click(screen.getByText('CREATE'));

    await waitFor(() => {
      expect(api.createKnowledge).toHaveBeenCalledWith(expect.objectContaining({ title: 'Run browser checks', sourceRefs: ['task:web'] }));
    });
  });
});

vi.mock('../src/api.js', () => ({
  AuthError: class AuthError extends Error {
    constructor(message = 'Unauthorized') {
      super(message);
      this.name = 'AuthError';
    }
  },
  WEB_COMMIT_SHA: 'test-commit',
  WEB_VERSION: 'test-version',
  buildWsUrl: (path: string) => `ws://localhost${path}`,
  setAuthFailureHandler: vi.fn(),
  verifyAuthToken: vi.fn(async () => ({ authenticated: true, mode: 'anonymous' })),
  getChannels: vi.fn(async () => [{ id: 'general', name: 'general', createdAt: '2026-04-25T00:00:00.000Z' }]),
  getProjects: vi.fn(async () => [{ id: 'default', name: 'Default Project', slug: 'default', description: '', createdAt: '2026-04-25T00:00:00.000Z', updatedAt: '2026-04-25T00:00:00.000Z' }]),
  getMessages: vi.fn(async () => []),
  getMessageThread: vi.fn(),
  sendMessage: vi.fn(),
  getAgents: vi.fn(async () => []),
  getMachines: vi.fn(async () => []),
  getRuntimeStatus: vi.fn(async () => ({ mode: 'paseo-daemon', configuredMode: 'paseo-daemon', connected: true })),
  getAgentActivities: vi.fn(async () => []),
  patchAgent: vi.fn(),
  deleteAgent: vi.fn(),
  getHubVersion: vi.fn(async () => ({ component: 'hub', version: 'test-version' })),
  getTasks: vi.fn(async () => []),
  getTaskPlan: vi.fn(async () => null),
  getApprovals: vi.fn(async () => []),
  createTaskPlan: vi.fn(),
  submitTaskPlan: vi.fn(),
  approveTaskPlan: vi.fn(),
  rejectTaskPlan: vi.fn(),
  approveApproval: vi.fn(),
  rejectApproval: vi.fn(),
  messageToTask: vi.fn(),
  messageToGoal: vi.fn(),
  startGoalAlignment: vi.fn(),
  patchGoalAlignment: vi.fn(),
  confirmGoalAlignment: vi.fn(),
  patchGoal: vi.fn(),
  createGoalTasks: vi.fn(),
  searchKnowledge: vi.fn(async () => []),
  createKnowledge: vi.fn(),
  patchKnowledge: vi.fn(),
  getAgentReminders: vi.fn(async () => []),
  getAgentDmThreads: vi.fn(async () => []),
  getAgentDirectMessages: vi.fn(async () => []),
  sendAgentDirectMessage: vi.fn(),
  createChannel: vi.fn(),
  deleteChannel: vi.fn(),
  searchMessages: vi.fn(async () => ({ messages: [] })),
}));
