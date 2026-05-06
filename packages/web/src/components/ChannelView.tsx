import { useLayoutEffect, useRef, useState } from 'react';
import type { Agent, AgentActivity, Message } from '../api.js';
import { MessageContent } from './MessageContent.js';
import { PresenceAvatar } from './PresenceAvatar.js';
import { t } from '../i18n.js';

type Props = {
  channelName: string;
  messages: Message[];
  agents: Agent[];
  activitiesByAgent: Record<string, AgentActivity[]>;
  channelId: string;
  targetMessageId?: string;
  onCreateTask?: (messageId: string) => void;
  onCreateGoal?: (messageId: string) => void;
  onOpenThread?: (message: Message) => void;
  onOpenAgent?: (agentId: string) => void;
  onTargetMessageSettled?: () => void;
};

export function ChannelView({
  channelName,
  messages,
  agents,
  activitiesByAgent,
  channelId,
  targetMessageId,
  onCreateTask,
  onCreateGoal,
  onOpenThread,
  onOpenAgent,
  onTargetMessageSettled,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollStateByChannel = useRef<Record<string, { scrollTop: number; nearBottom: boolean }>>({});
  const messageCountByChannel = useRef<Record<string, number>>({});
  const lastChannelId = useRef(channelId);
  const [showJumpByChannel, setShowJumpByChannel] = useState<Record<string, boolean>>({});
  const [threadsOpen, setThreadsOpen] = useState(false);
  const threadRoots = messages
    .filter((message) => (message.replyCount ?? 0) > 0)
    .sort((a, b) => new Date(b.latestReplyAt ?? b.createdAt).getTime() - new Date(a.latestReplyAt ?? a.createdAt).getTime());

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    if (lastChannelId.current !== channelId) {
      lastChannelId.current = channelId;
      const savedState = scrollStateByChannel.current[channelId] ?? { scrollTop: 0, nearBottom: true };
      scrollEl.scrollTop = Math.min(savedState.scrollTop, Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight));
      setShowJumpByChannel((prev) => ({ ...prev, [channelId]: !savedState.nearBottom }));
      messageCountByChannel.current[channelId] = messages.length;
      return;
    }

    if (targetMessageId) {
      const target = scrollEl.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(targetMessageId)}"]`);
      if (target) {
        target.scrollIntoView({ block: 'center' });
        target.classList.add('message-row-target');
        window.setTimeout(() => target.classList.remove('message-row-target'), 1800);
        onTargetMessageSettled?.();
      }
      messageCountByChannel.current[channelId] = messages.length;
      const nearBottom = isNearBottom(scrollEl);
      scrollStateByChannel.current[channelId] = { scrollTop: scrollEl.scrollTop, nearBottom };
      setShowJumpByChannel((prev) => ({ ...prev, [channelId]: !nearBottom }));
      return;
    }

    const previousCount = messageCountByChannel.current[channelId] ?? 0;
    if (messages.length > previousCount) {
      const savedState = scrollStateByChannel.current[channelId] ?? { scrollTop: 0, nearBottom: true };
      if (savedState.nearBottom) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
        scrollStateByChannel.current[channelId] = { scrollTop: scrollEl.scrollTop, nearBottom: true };
        setShowJumpByChannel((prev) => ({ ...prev, [channelId]: false }));
      } else {
        setShowJumpByChannel((prev) => ({ ...prev, [channelId]: true }));
      }
    }
    messageCountByChannel.current[channelId] = messages.length;
  }, [channelId, messages, targetMessageId, onTargetMessageSettled]);

  const handleScroll = () => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const nearBottom = isNearBottom(scrollEl);
    scrollStateByChannel.current[channelId] = { scrollTop: scrollEl.scrollTop, nearBottom };
    setShowJumpByChannel((prev) => ({ ...prev, [channelId]: !nearBottom }));
  };

  const jumpToLatest = () => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
    scrollStateByChannel.current[channelId] = { scrollTop: scrollEl.scrollHeight, nearBottom: true };
    setShowJumpByChannel((prev) => ({ ...prev, [channelId]: false }));
  };

  return (
    <div className="channel-view" style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: '#fff',
      minHeight: 0,
      fontFamily: "'Courier New', monospace",
    }}>
      {/* Channel header */}
      <div className="channel-header" style={{
        height: 48,
        padding: '0 16px',
        borderBottom: '2px solid #000',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: '#fff',
        flexShrink: 0,
      }}>
        <div style={{
          width: 28,
          height: 28,
          border: '2px solid #000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 16,
          background: '#FFD700',
        }}>
          #
        </div>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{channelName}</span>
        <span style={{ fontSize: 12, color: '#888', marginLeft: 4 }}>— chat channel</span>
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <button
            type="button"
            onClick={() => setThreadsOpen((open) => !open)}
            style={threadListButtonStyle}
          >
            {t('thread.list')} {threadRoots.length ? `(${threadRoots.length})` : ''}
          </button>
          {threadsOpen ? (
            <div style={threadListMenuStyle}>
              {threadRoots.length === 0 ? (
                <div style={{ padding: 12, color: '#888', fontSize: 12 }}>{t('thread.empty')}</div>
              ) : threadRoots.map((message) => (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => {
                    setThreadsOpen(false);
                    onOpenThread?.(message);
                  }}
                  style={threadListItemStyle}
                >
                  <span style={{ fontWeight: 700, fontSize: 11 }}>
                    {message.senderName} · {t('thread.replies', { count: message.replyCount ?? 0 })}
                  </span>
                  <span style={{ color: '#777', fontSize: 10 }}>
                    {formatTime(message.latestReplyAt ?? message.createdAt)}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {summarizeMessage(message.content)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="message-list" style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        background: '#fbfbf7',
      }}>
        {messages.length === 0 && (
          <div style={{
            color: '#aaa',
            fontSize: 12,
            textAlign: 'center',
            marginTop: 48,
            border: '2px dashed #ddd',
            padding: '20px',
          }}>
            [ NO MESSAGES YET — START THE CONVERSATION ]
          </div>
        )}
        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const grouped = prev && prev.senderName === msg.senderName &&
            new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60 * 1000;
          const agent = msg.agentId ? agents.find((candidate) => candidate.id === msg.agentId) : undefined;
          const latestActivity = msg.agentId ? activitiesByAgent[msg.agentId]?.[0] : undefined;

          return (
            <div key={msg.id} data-message-id={msg.id} className={`message-row${grouped ? ' message-row-grouped' : ''}`} style={{
              display: 'flex',
              gap: 10,
              padding: grouped ? '1px 0 1px 46px' : '8px 0 2px',
              maxWidth: 1040,
            }}>
              {!grouped && (
                <PresenceAvatar
                  name={msg.senderName}
                  isAgent={!!msg.agentId}
                  status={agent?.status as any}
                  latestActivity={latestActivity}
                  onClick={agent ? () => onOpenAgent?.(agent.id) : undefined}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                {!grouped && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{msg.senderName}</span>
                    <span style={intentBadgeStyle(msg.intent ?? 'chat')}>{msg.intent ?? 'chat'}</span>
                    <span style={{ fontSize: 10, color: '#999', fontFamily: "'Courier New', monospace" }}>
                      {formatTime(msg.createdAt)}
                    </span>
                    <div className="message-actions" style={{ marginLeft: 'auto', display: 'flex', gap: 4, opacity: 0.18 }}>
                    {onOpenThread && (
                      <button
                        onClick={() => onOpenThread(msg)}
                        title={t('message.replyInThread')}
                        style={messageActionStyle}
                      >
                        {t('message.replyInThread')}
                      </button>
                    )}
                    {onCreateTask && (
                      <button
                        onClick={() => onCreateTask(msg.id)}
                        title={t('message.createTask')}
                        style={messageActionStyle}
                      >
                        {t('message.createTask')}
                      </button>
                    )}
                    {onCreateGoal && (
                      <button
                        onClick={() => onCreateGoal(msg.id)}
                        title={t('message.planGoal')}
                        style={messageActionStyle}
                      >
                        {t('message.planGoal')}
                      </button>
                    )}
                    </div>
                  </div>
                )}
                <MessageContent content={msg.content} mentions={msg.mentions} onOpenAgent={onOpenAgent} />
                {msg.replyCount ? (
                  <button
                    onClick={() => onOpenThread?.(msg)}
                    style={threadReplyButtonStyle}
                  >
                    <span aria-hidden="true">▱</span>
                    {t('thread.replies', { count: msg.replyCount })}
                    {msg.latestReplyAt ? <span style={{ color: '#555' }}>{formatTime(msg.latestReplyAt)}</span> : null}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
        {showJumpByChannel[channelId] ? (
          <button type="button" onClick={jumpToLatest} style={jumpButtonStyle}>
            ↓ Back to bottom
          </button>
        ) : null}
      </div>
    </div>
  );
}

const messageActionStyle: React.CSSProperties = {
  border: '1px solid #c8c8b8',
  background: '#fff',
  minHeight: 20,
  padding: '0 6px',
  fontSize: 10,
  fontWeight: 700,
  fontFamily: "'Courier New', monospace",
  cursor: 'pointer',
  borderRadius: 3,
};

const jumpButtonStyle: React.CSSProperties = {
  position: 'sticky',
  bottom: 10,
  alignSelf: 'center',
  border: '2px solid #000',
  background: '#fff',
  color: '#111',
  fontFamily: "'Courier New', monospace",
  fontSize: 13,
  fontWeight: 700,
  padding: '8px 13px',
  borderRadius: 0,
  cursor: 'pointer',
  boxShadow: '4px 4px 0 #000',
  zIndex: 2,
};

const threadReplyButtonStyle: React.CSSProperties = {
  marginTop: 7,
  border: '2px solid #000',
  background: '#dff8ff',
  color: '#111',
  fontSize: 12,
  fontWeight: 700,
  fontFamily: "'Courier New', monospace",
  cursor: 'pointer',
  padding: '5px 9px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  boxShadow: '2px 2px 0 #000',
};

const threadListButtonStyle: React.CSSProperties = {
  border: '1px solid #c8c8b8',
  background: '#fff',
  minHeight: 26,
  padding: '0 9px',
  fontSize: 12,
  fontWeight: 700,
  fontFamily: "'Courier New', monospace",
  cursor: 'pointer',
  borderRadius: 4,
};

const threadListMenuStyle: React.CSSProperties = {
  position: 'absolute',
  top: 32,
  right: 0,
  width: 320,
  maxHeight: 'min(420px, calc(100vh - 90px))',
  overflowY: 'auto',
  border: '1px solid #c8c8b8',
  background: '#fff',
  boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
  zIndex: 4,
  borderRadius: 6,
};

const threadListItemStyle: React.CSSProperties = {
  width: '100%',
  border: 0,
  borderBottom: '1px solid #efefe5',
  background: '#fff',
  padding: '9px 10px',
  display: 'grid',
  gap: 3,
  textAlign: 'left',
  fontFamily: "'Courier New', monospace",
  fontSize: 12,
  cursor: 'pointer',
};

function intentBadgeStyle(intent: 'chat' | 'task' | 'goal'): React.CSSProperties {
  const palette = {
    goal: { bg: '#dbeaff', fg: '#1547a0' },
    task: { bg: '#e7fae7', fg: '#156a2b' },
    chat: { bg: '#efefef', fg: '#555' },
  } as const;
  return {
    border: '1px solid #999',
    background: palette[intent].bg,
    color: palette[intent].fg,
    fontSize: 9,
    fontWeight: 700,
    padding: '1px 5px',
    textTransform: 'uppercase',
  };
}

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function summarizeMessage(content: string): string {
  return content.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || '[empty message]';
}
