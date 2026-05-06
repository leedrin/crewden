export type JsonSchema = Record<string, unknown>;

export type ToolContext = {
  client: CrewdenInternalClient;
};

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  run: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
};

type RequestOptions = {
  query?: Record<string, unknown>;
  body?: unknown;
};

export class CrewdenInternalClient {
  private readonly baseUrl: string;
  private readonly agentId: string;
  private readonly authToken: string;

  constructor(params: { baseUrl: string; agentId: string; authToken: string }) {
    this.baseUrl = params.baseUrl.replace(/\/+$/, "");
    this.agentId = params.agentId;
    this.authToken = params.authToken;
  }

  getAgentId(): string {
    return this.agentId;
  }

  async get(path: string, options: RequestOptions = {}): Promise<unknown> {
    return this.request("GET", path, options);
  }

  async post(path: string, options: RequestOptions = {}): Promise<unknown> {
    return this.request("POST", path, options);
  }

  private async request(method: "GET" | "POST", path: string, options: RequestOptions): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item === undefined || item === null || item === "") continue;
          url.searchParams.append(key, String(item));
        }
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.authToken}`,
        "x-agent-id": this.agentId,
      },
      body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
    });

    const text = await response.text();
    const payload = safeJsonParse(text);
    if (!response.ok) {
      const message = extractErrorMessage(payload) ?? `${method} ${path} failed with ${response.status}`;
      throw new Error(message);
    }
    return payload;
  }
}

export function createToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "crewden_send_message",
      title: "Send Channel Message",
      description: "Send a message to a Crewden channel.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel id or channel name. Defaults to general." },
          content: { type: "string", description: "Message content." },
          threadRootId: { type: "string", description: "Thread root message id (optional)." },
        },
        required: ["content"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.post(agentPath(client, "/messages/send"), {
          body: {
            channel: asString(args.channel) ?? "general",
            content: requiredString(args.content, "content"),
            threadRootId: asString(args.threadRootId),
          },
        });
      },
    },
    {
      name: "crewden_check_messages",
      title: "Check Messages",
      description: "Check channel and DM summaries for new messages.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: async (_args, { client }) => {
        return client.get(agentPath(client, "/messages/check"));
      },
    },
    {
      name: "crewden_inbox",
      title: "Check Inbox",
      description: "Load assigned/claimable/review/blocker inbox items with next-step guidance.",
      inputSchema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            description:
              "Optional kind filter: mention|dm|assigned_task|claimable_task|reminder|review_request|blocked_escalation|review_requested|approval_required|task_blocked|thread_update",
          },
          limit: { type: "number", description: "Max inbox items to return (default 20)." },
        },
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.get(agentPath(client, "/work"), {
          query: {
            kind: asString(args.kind),
            limit: asNumber(args.limit),
          },
        });
      },
    },
    {
      name: "crewden_read_history",
      title: "Read Channel History",
      description: "Read recent messages in a channel.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel id or name." },
          limit: { type: "number", description: "Max messages to return (default 20)." },
        },
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.get(agentPath(client, "/messages/read"), {
          query: {
            channel: asString(args.channel) ?? "general",
            limit: asNumber(args.limit),
          },
        });
      },
    },
    {
      name: "crewden_send_dm",
      title: "Send Direct Message",
      description: "Send a direct message to another agent.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Target agent id, name, or displayName." },
          content: { type: "string", description: "DM content." },
        },
        required: ["to", "content"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.post(agentPath(client, "/dms/send"), {
          body: {
            to: requiredString(args.to, "to"),
            content: requiredString(args.content, "content"),
          },
        });
      },
    },
    {
      name: "crewden_delegate",
      title: "Delegate Task To Agent",
      description: "Delegate work to another agent.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Target agent id or name." },
          content: { type: "string", description: "Delegation details." },
          startIfInactive: { type: "boolean", description: "Start target agent automatically if inactive." },
        },
        required: ["to", "content"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.post(agentPath(client, "/delegate"), {
          body: {
            to: requiredString(args.to, "to"),
            content: requiredString(args.content, "content"),
            startIfInactive: asBoolean(args.startIfInactive),
          },
        });
      },
    },
    {
      name: "crewden_list_agents",
      title: "List Agents",
      description: "List all agents visible to this workspace.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: async (_args, { client }) => {
        const info = await client.get(agentPath(client, "/server/info")) as { agents?: unknown[] };
        return info.agents ?? [];
      },
    },
    {
      name: "crewden_agent_profile",
      title: "Show Agent Profile",
      description: "Show current agent profile with role/capabilities/permissions.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: async (_args, { client }) => {
        const whoami = await client.get(agentPath(client, "/auth/whoami")) as { agent?: unknown };
        return whoami.agent ?? {};
      },
    },
    {
      name: "crewden_resolve_agents",
      title: "Resolve Agents",
      description: "Find matching agents by role/capabilities or free-text query.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free text query." },
          role: { type: "string", description: "product|architect|developer|qa|reviewer|security|devops|documentation|coordinator|planner|unassigned" },
          capabilities: { type: "array", items: { type: "string" }, description: "requirements|coding|review|testing|security|deployment|docs|research|planning" },
          excludeAgentId: { type: "string", description: "Agent id to exclude." },
          mustBeIdle: { type: "boolean", description: "Only return idle agents." },
          maxResults: { type: "number", description: "Limit result count." },
        },
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.get(agentPath(client, "/agents/resolve"), {
          query: {
            query: asString(args.query),
            role: asString(args.role),
            capabilities: asStringArray(args.capabilities),
            excludeAgentId: asString(args.excludeAgentId),
            mustBeIdle: asBoolean(args.mustBeIdle),
            maxResults: asNumber(args.maxResults),
          },
        });
      },
    },
    {
      name: "crewden_list_channels",
      title: "List Channels",
      description: "List all channels visible to this workspace.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: async (_args, { client }) => {
        const info = await client.get(agentPath(client, "/server/info")) as { channels?: unknown[] };
        return info.channels ?? [];
      },
    },
    {
      name: "crewden_create_channel",
      title: "Create Channel",
      description: "Create a new Crewden channel.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "New channel name." },
        },
        required: ["name"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.post(agentPath(client, "/channels/create"), {
          body: { name: requiredString(args.name, "name") },
        });
      },
    },
    {
      name: "crewden_invite_agent",
      title: "Invite Agent To Channel",
      description: "Invite an agent to a channel by posting a mention in that channel.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel id or name." },
          agent: { type: "string", description: "Agent id/name/displayName to invite." },
          note: { type: "string", description: "Optional invitation note." },
        },
        required: ["channel", "agent"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        const channel = requiredString(args.channel, "channel");
        const agentQuery = requiredString(args.agent, "agent");
        const resolved = await client.get(agentPath(client, "/agents/resolve"), {
          query: { query: agentQuery },
        }) as { match?: { id?: string; label?: string } | null };
        if (!resolved.match?.id) {
          throw new Error(`Target agent '${agentQuery}' not found`);
        }
        const label = resolved.match.label ?? resolved.match.id;
        const note = asString(args.note);
        const invitation = note
          ? `@${label} You are invited to join #${channel}. ${note}`
          : `@${label} You are invited to join #${channel}.`;
        const message = await client.post(agentPath(client, "/messages/send"), {
          body: {
            channel,
            content: invitation,
          },
        });
        return {
          invitedAgentId: resolved.match.id,
          invitedLabel: label,
          channel,
          message,
        };
      },
    },
    {
      name: "crewden_create_task",
      title: "Create Task",
      description: "Create a task in Crewden task board.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel id or name. Defaults to general." },
          title: { type: "string", description: "Task title." },
          assigneeId: { type: "string", description: "Assignee agent id/name (optional)." },
          creatorName: { type: "string", description: "Creator label (optional)." },
          context: { type: "object", description: "Task context object." },
        },
        required: ["title"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.post(agentPath(client, "/tasks/create"), {
          body: {
            channel: asString(args.channel) ?? "general",
            title: requiredString(args.title, "title"),
            assigneeId: asString(args.assigneeId),
            creatorName: asString(args.creatorName),
            context: asRecord(args.context),
          },
        });
      },
    },
    {
      name: "crewden_list_tasks",
      title: "List Tasks",
      description: "List tasks by channel/status. Defaults to assigned tasks for current agent.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel id or name." },
          status: { type: "string", description: "backlog|spec_needed|ready|assigned|in_progress|in_review|changes_requested|qa|done|cancelled" },
          all: { type: "boolean", description: "Set true to include tasks not assigned to current agent." },
        },
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.get(agentPath(client, "/tasks"), {
          query: {
            channel: asString(args.channel),
            status: asString(args.status),
            all: asBoolean(args.all),
          },
        });
      },
    },
    {
      name: "crewden_get_task",
      title: "Get Task",
      description: "Get one task by task id.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task id." },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        const taskId = requiredString(args.taskId, "taskId");
        return client.get(agentPath(client, `/tasks/${encodeURIComponent(taskId)}`));
      },
    },
    {
      name: "crewden_update_task",
      title: "Update Task",
      description: "Update task status/assignee/context.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task id." },
          status: { type: "string", description: "backlog|spec_needed|ready|assigned|in_progress|in_review|changes_requested|qa|done|cancelled. Use crewden_block_task to record blockers instead of a blocked status." },
          assigneeId: { type: "string", description: "Assignee agent id/name." },
          context: { type: "object", description: "Task context patch." },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        const taskId = requiredString(args.taskId, "taskId");
        return client.post(agentPath(client, `/tasks/${encodeURIComponent(taskId)}/update`), {
          body: {
            status: asString(args.status),
            assigneeId: asString(args.assigneeId),
            context: asRecord(args.context),
          },
        });
      },
    },
    {
      name: "crewden_claim_task",
      title: "Claim Task",
      description: "Claim an unassigned task.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task id." },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        const taskId = requiredString(args.taskId, "taskId");
        return client.post(agentPath(client, `/tasks/${encodeURIComponent(taskId)}/claim`));
      },
    },
    {
      name: "crewden_progress_task",
      title: "Report Task Progress",
      description: "Post heartbeat/progress detail for a task.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task id." },
          detail: { type: "string", description: "Progress detail." },
        },
        required: ["taskId", "detail"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        const taskId = requiredString(args.taskId, "taskId");
        return client.post(agentPath(client, `/tasks/${encodeURIComponent(taskId)}/progress`), {
          body: { detail: requiredString(args.detail, "detail") },
        });
      },
    },
    {
      name: "crewden_block_task",
      title: "Report Task Blocker",
      description: "Record a blocker without changing the task's 10-state workflow status.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task id." },
          reason: { type: "string", description: "Why the task is blocked." },
          needs: { type: "string", description: "What is needed to unblock the task." },
        },
        required: ["taskId", "reason", "needs"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        const taskId = requiredString(args.taskId, "taskId");
        return client.post(agentPath(client, `/tasks/${encodeURIComponent(taskId)}/block`), {
          body: {
            reason: requiredString(args.reason, "reason"),
            needs: requiredString(args.needs, "needs"),
          },
        });
      },
    },
    {
      name: "crewden_handoff_task",
      title: "Handoff Task",
      description: "Handoff task ownership to another agent.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task id." },
          to: { type: "string", description: "Target agent id/name." },
          notes: { type: "string", description: "Handoff notes." },
          goal: { type: "string", description: "Optional goal override." },
          nextStep: { type: "string", description: "Optional next step hint." },
        },
        required: ["taskId", "to", "notes"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        const taskId = requiredString(args.taskId, "taskId");
        return client.post(agentPath(client, `/tasks/${encodeURIComponent(taskId)}/handoff`), {
          body: {
            to: requiredString(args.to, "to"),
            notes: requiredString(args.notes, "notes"),
            goal: asString(args.goal),
            nextStep: asString(args.nextStep),
          },
        });
      },
    },
    {
      name: "crewden_review_request",
      title: "Request Review",
      description: "Request a review for a task.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task id." },
          reviewerAgentId: { type: "string", description: "Reviewer agent id/name." },
          evidence: { type: "array", items: { type: "string" }, description: "Evidence list." },
          checklist: {
            type: "array",
            items: {
              oneOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    checked: { type: "boolean" },
                  },
                  required: ["label"],
                },
              ],
            },
            description: "Checklist items.",
          },
          comment: { type: "string" },
          allowSelfReview: { type: "boolean" },
          selfReviewReason: { type: "string" },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        const taskId = requiredString(args.taskId, "taskId");
        return client.post(agentPath(client, `/tasks/${encodeURIComponent(taskId)}/reviews`), {
          body: {
            reviewerAgentId: asString(args.reviewerAgentId),
            evidence: asStringArray(args.evidence),
            checklist: asChecklistArray(args.checklist),
            comment: asString(args.comment),
            allowSelfReview: asBoolean(args.allowSelfReview),
            selfReviewReason: asString(args.selfReviewReason),
          },
        });
      },
    },
    {
      name: "crewden_create_goal",
      title: "Create Goal",
      description: "Create a goal brief in Crewden.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel id or name." },
          objective: { type: "string", description: "Goal objective." },
          background: { type: "array", items: { type: "string" } },
          successCriteria: { type: "array", items: { type: "string" } },
          constraints: { type: "array", items: { type: "string" } },
          assumptions: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } },
        },
        required: ["objective"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.post(agentPath(client, "/goals"), {
          body: {
            channel: asString(args.channel) ?? "general",
            objective: requiredString(args.objective, "objective"),
            background: asStringArray(args.background),
            successCriteria: asStringArray(args.successCriteria),
            constraints: asStringArray(args.constraints),
            assumptions: asStringArray(args.assumptions),
            risks: asStringArray(args.risks),
          },
        });
      },
    },
    {
      name: "crewden_list_goals",
      title: "List Goals",
      description: "List goals by channel/status.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel id or name." },
          status: { type: "string", description: "draft|confirmed|cancelled|completed" },
        },
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.get(agentPath(client, "/goals"), {
          query: {
            channel: asString(args.channel),
            status: asString(args.status),
          },
        });
      },
    },
    {
      name: "crewden_list_decisions",
      title: "List Decisions",
      description: "List architecture/product decisions by channel/status.",
      inputSchema: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Channel id." },
          status: { type: "string", description: "proposed|accepted|deprecated|superseded" },
        },
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.get(agentPath(client, "/decisions"), {
          query: {
            channelId: asString(args.channelId),
            status: asString(args.status),
          },
        });
      },
    },
    {
      name: "crewden_create_decision",
      title: "Create Decision",
      description: "Create a decision (ADR-style) record.",
      inputSchema: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Channel id." },
          sourceThreadId: { type: "string", description: "Source thread id." },
          title: { type: "string", description: "Decision title." },
          problem: { type: "string", description: "Problem statement." },
          decisionText: { type: "string", description: "Decision conclusion." },
          rationale: { type: "string", description: "Rationale." },
          alternatives: { type: "array", items: { type: "string" } },
          consequences: { type: "array", items: { type: "string" } },
        },
        required: ["channelId", "title", "problem", "decisionText"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.post(agentPath(client, "/decisions/create"), {
          body: {
            channelId: requiredString(args.channelId, "channelId"),
            sourceThreadId: asString(args.sourceThreadId),
            title: requiredString(args.title, "title"),
            problem: requiredString(args.problem, "problem"),
            decisionText: requiredString(args.decisionText, "decisionText"),
            rationale: asString(args.rationale),
            alternatives: asStringArray(args.alternatives),
            consequences: asStringArray(args.consequences),
          },
        });
      },
    },
    {
      name: "crewden_list_documents",
      title: "List Documents",
      description: "List documents by kind/status/channel.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", description: "prd|tdd|adr|rfc|test_plan|runbook|postmortem" },
          status: { type: "string", description: "draft|in_review|approved|deprecated|superseded" },
          channelId: { type: "string", description: "Source channel id." },
        },
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.get(agentPath(client, "/documents"), {
          query: {
            kind: asString(args.kind),
            status: asString(args.status),
            channelId: asString(args.channelId),
          },
        });
      },
    },
    {
      name: "crewden_create_document",
      title: "Create Document",
      description: "Create a PRD/TDD/ADR/RFC/test plan/runbook/postmortem document.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", description: "Document kind." },
          title: { type: "string", description: "Document title." },
          content: { type: "string", description: "Markdown content." },
          sourceChannelId: { type: "string", description: "Source channel id." },
          sourceThreadId: { type: "string", description: "Source thread id." },
          relatedDecisions: { type: "array", items: { type: "string" } },
          relatedTasks: { type: "array", items: { type: "string" } },
        },
        required: ["kind", "title", "sourceChannelId"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        const info = await client.get(agentPath(client, "/auth/whoami")) as { agent?: { id?: string; displayName?: string; name?: string } };
        const actorId = info.agent?.id ?? client.getAgentId();
        const actorName = info.agent?.displayName ?? info.agent?.name ?? actorId;
        return client.post(agentPath(client, "/documents/create"), {
          body: {
            kind: requiredString(args.kind, "kind"),
            title: requiredString(args.title, "title"),
            content: asString(args.content) ?? "",
            sourceChannelId: requiredString(args.sourceChannelId, "sourceChannelId"),
            sourceThreadId: asString(args.sourceThreadId),
            authorType: "agent",
            authorId: actorId,
            authorName: actorName,
            relatedDecisions: asStringArray(args.relatedDecisions),
            relatedTasks: asStringArray(args.relatedTasks),
          },
        });
      },
    },
    {
      name: "crewden_search_knowledge",
      title: "Search Knowledge",
      description: "Search knowledge entries.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          kind: { type: "string" },
          tag: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.get(agentPath(client, "/knowledge"), {
          query: {
            query: asString(args.query),
            kind: asString(args.kind),
            tag: asStringOrStringArray(args.tag),
            limit: asNumber(args.limit),
          },
        });
      },
    },
    {
      name: "crewden_upload_knowledge",
      title: "Upload Knowledge",
      description: "Write a knowledge entry into Crewden knowledge base.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", description: "decision|project_archive|user_preference|runbook|learning|artifact" },
          title: { type: "string" },
          summary: { type: "string" },
          body: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          sourceRefs: { type: "array", items: { type: "string" } },
          ownerAgentId: { type: "string" },
          reviewerAgentId: { type: "string" },
          status: { type: "string", description: "active|stale|conflict|archived" },
          allowNoSource: { type: "boolean" },
        },
        required: ["kind", "title", "summary", "body"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.post(agentPath(client, "/knowledge"), {
          body: {
            kind: requiredString(args.kind, "kind"),
            title: requiredString(args.title, "title"),
            summary: requiredString(args.summary, "summary"),
            body: requiredString(args.body, "body"),
            tags: asStringArray(args.tags),
            sourceRefs: asStringArray(args.sourceRefs),
            ownerAgentId: asString(args.ownerAgentId),
            reviewerAgentId: asString(args.reviewerAgentId),
            status: asString(args.status),
            allowNoSource: asBoolean(args.allowNoSource),
          },
        });
      },
    },
    {
      name: "crewden_set_reminder",
      title: "Set Reminder",
      description: "Schedule a reminder for the current agent.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel id or name." },
          message: { type: "string", description: "Reminder message." },
          triggerAt: { type: "string", description: "ISO datetime string." },
        },
        required: ["message", "triggerAt"],
        additionalProperties: false,
      },
      run: async (args, { client }) => {
        return client.post(agentPath(client, "/reminders"), {
          body: {
            channelId: asString(args.channel) ?? "general",
            message: requiredString(args.message, "message"),
            triggerAt: requiredString(args.triggerAt, "triggerAt"),
          },
        });
      },
    },
  ];
}

function agentPath(client: CrewdenInternalClient, suffix: string): string {
  return `/internal/agent/${encodeURIComponent(client.getAgentId())}${suffix}`;
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

function safeJsonParse(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function requiredString(value: unknown, field: string): string {
  const text = asString(value);
  if (!text) throw new Error(`Missing required field: ${field}`);
  return text;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item));
}

function asStringOrStringArray(value: unknown): string | string[] | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const items = asStringArray(value);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

function asChecklistArray(value: unknown): Array<string | { label: string; checked?: boolean }> {
  if (!Array.isArray(value)) return [];
  const result: Array<string | { label: string; checked?: boolean }> = [];
  for (const item of value) {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) result.push(text);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const label = asString((item as { label?: unknown }).label);
    if (!label) continue;
    const checked = asBoolean((item as { checked?: unknown }).checked);
    result.push(checked === undefined ? { label } : { label, checked });
  }
  return result;
}
