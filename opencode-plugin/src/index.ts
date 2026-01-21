/**
 * Claude-mem OpenCode Plugin
 *
 * Provides persistent memory across sessions by:
 * 1. Injecting context from past sessions on chat start
 * 2. Capturing tool executions as observations
 * 3. Summarizing sessions when compacting
 * 4. Exposing search tools for querying memory
 */

import type { Plugin, Hooks } from '@opencode-ai/plugin';

// Worker service configuration
const WORKER_PORT = process.env.CLAUDE_MEM_PORT ? parseInt(process.env.CLAUDE_MEM_PORT, 10) : 37777;
const WORKER_HOST = process.env.CLAUDE_MEM_HOST ?? '127.0.0.1';
const WORKER_BASE_URL = `http://${WORKER_HOST}:${WORKER_PORT}`;

/**
 * Check if worker service is available
 */
async function ensureWorker(): Promise<boolean> {
  try {
    const response = await fetch(`${WORKER_BASE_URL}/api/readiness`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Claude-mem plugin for OpenCode
 *
 * Integrates with OpenCode's hook system to provide persistent memory
 * across coding sessions. All data is stored locally via the worker service.
 */
export const ClaudeMemPlugin: Plugin = async ({ project, directory }) => {
  // Generate unique session ID for this OpenCode session
  const sessionId = `opencode-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  let sessionInitialized = false;
  let sessionDbId: number | null = null;

  const hooks: Hooks = {
    /**
     * chat.message - Initialize session on first user message
     *
     * Maps to UserPromptSubmit hook in Claude Code
     */
    'chat.message': async (input, _output) => {
      if (!await ensureWorker()) return;
      if (sessionInitialized) return;

      try {
        const prompt = typeof input === 'object' && input !== null
          ? (input as { content?: string }).content ?? ''
          : '';

        const response = await fetch(`${WORKER_BASE_URL}/api/sessions/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentSessionId: sessionId,
            project: project?.name ?? 'unknown',
            prompt,
          }),
        });

        if (response.ok) {
          const result = await response.json() as { sessionDbId?: number };
          sessionDbId = result.sessionDbId ?? null;
          sessionInitialized = true;
        }
      } catch (error) {
        // Silently fail - memory is non-critical
        console.error('claude-mem: session init failed', error);
      }
    },

    /**
     * tool.execute.after - Capture tool usage as observations
     *
     * Maps to PostToolUse hook in Claude Code
     */
    'tool.execute.after': async (input, toolOutput) => {
      if (!await ensureWorker()) return;
      if (!sessionInitialized) return;

      try {
        const toolInfo = input as {
          tool?: { name?: string; input?: unknown };
        };

        await fetch(`${WORKER_BASE_URL}/api/sessions/observations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentSessionId: sessionId,
            tool_name: toolInfo.tool?.name ?? 'unknown',
            tool_input: toolInfo.tool?.input,
            tool_response: toolOutput,
            cwd: directory,
          }),
        });
      } catch (error) {
        // Silently fail - memory is non-critical
        console.error('claude-mem: observation capture failed', error);
      }
    },

    /**
     * experimental.chat.system.transform - Inject memory context
     *
     * Maps to SessionStart context injection in Claude Code
     */
    'experimental.chat.system.transform': async (_input, output) => {
      if (!await ensureWorker()) return;

      try {
        const projectName = project?.name ?? 'unknown';
        const response = await fetch(
          `${WORKER_BASE_URL}/api/context/inject?projects=${encodeURIComponent(projectName)}`,
        );

        if (response.ok) {
          const context = await response.text();
          if (context.trim()) {
            // Append memory context to system prompt
            const outputObj = output as { system?: string };
            outputObj.system = (outputObj.system ?? '') + '\n\n' + context;
          }
        }
      } catch (error) {
        // Silently fail - context injection is optional
        console.error('claude-mem: context injection failed', error);
      }
    },

    /**
     * experimental.session.compacting - Trigger summarization
     *
     * Maps to Stop/Summary hook in Claude Code
     */
    'experimental.session.compacting': async (input, _output) => {
      if (!await ensureWorker()) return;
      if (!sessionInitialized) return;

      try {
        const inputObj = input as { messages?: Array<{ role?: string; content?: string }> };
        const messages = inputObj.messages ?? [];

        // Extract last assistant message for summarization context
        const lastAssistantMessage = messages
          .filter((m) => m.role === 'assistant')
          .pop()?.content ?? '';

        await fetch(`${WORKER_BASE_URL}/api/sessions/summarize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentSessionId: sessionId,
            last_assistant_message: lastAssistantMessage,
          }),
        });
      } catch (error) {
        // Silently fail - summarization is non-critical
        console.error('claude-mem: summarization failed', error);
      }
    },

    /**
     * Custom tools for memory search
     *
     * Exposes the same search capabilities as the MCP server tools
     */
    tool: {
      /**
       * mem-search - Search memory for past observations and sessions
       *
       * Step 1 in the 3-layer workflow: Get index with IDs
       */
      'mem-search': {
        description: 'Search claude-mem memory. Returns index with IDs for observations, summaries, and sessions. Use this first, then mem-timeline for context, then mem-get-observations for full details.',
        parameters: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string',
              description: 'Search query (natural language)',
            },
            limit: {
              type: 'number',
              description: 'Maximum results (default: 20)',
            },
            project: {
              type: 'string',
              description: 'Filter by project name',
            },
            type: {
              type: 'string',
              enum: ['observation', 'summary', 'session'],
              description: 'Filter by type',
            },
            dateStart: {
              type: 'string',
              description: 'Filter from date (ISO format)',
            },
            dateEnd: {
              type: 'string',
              description: 'Filter to date (ISO format)',
            },
          },
        },
        execute: async (params: Record<string, unknown>) => {
          if (!await ensureWorker()) {
            return { error: 'Worker service unavailable' };
          }

          try {
            const searchParams = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
              if (value !== undefined && value !== null) {
                searchParams.set(key, String(value));
              }
            }

            const response = await fetch(`${WORKER_BASE_URL}/api/search?${searchParams}`);
            if (!response.ok) {
              return { error: `Search failed: ${response.status}` };
            }

            return await response.json();
          } catch (error) {
            return { error: `Search error: ${error instanceof Error ? error.message : String(error)}` };
          }
        },
      },

      /**
       * mem-timeline - Get chronological context around an observation
       *
       * Step 2 in the 3-layer workflow: Get context around results
       */
      'mem-timeline': {
        description: 'Get chronological context around a memory observation. Use after mem-search to understand context.',
        parameters: {
          type: 'object' as const,
          properties: {
            anchor: {
              type: 'number',
              description: 'Observation ID to anchor timeline',
            },
            query: {
              type: 'string',
              description: 'Alternative: find anchor by query',
            },
            depth_before: {
              type: 'number',
              description: 'Items before anchor (default: 3)',
            },
            depth_after: {
              type: 'number',
              description: 'Items after anchor (default: 3)',
            },
            project: {
              type: 'string',
              description: 'Filter by project',
            },
          },
        },
        execute: async (params: Record<string, unknown>) => {
          if (!await ensureWorker()) {
            return { error: 'Worker service unavailable' };
          }

          try {
            const searchParams = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
              if (value !== undefined && value !== null) {
                searchParams.set(key, String(value));
              }
            }

            const response = await fetch(`${WORKER_BASE_URL}/api/timeline?${searchParams}`);
            if (!response.ok) {
              return { error: `Timeline failed: ${response.status}` };
            }

            return await response.json();
          } catch (error) {
            return { error: `Timeline error: ${error instanceof Error ? error.message : String(error)}` };
          }
        },
      },

      /**
       * mem-get-observations - Fetch full details for specific observation IDs
       *
       * Step 3 in the 3-layer workflow: Fetch full details for filtered IDs
       */
      'mem-get-observations': {
        description: 'Fetch full details for specific observation IDs. Use after mem-search and mem-timeline to get complete information.',
        parameters: {
          type: 'object' as const,
          properties: {
            ids: {
              type: 'array',
              items: { type: 'number' },
              description: 'Array of observation IDs to fetch',
            },
          },
          required: ['ids'],
        },
        execute: async (params: Record<string, unknown>) => {
          if (!await ensureWorker()) {
            return { error: 'Worker service unavailable' };
          }

          try {
            const response = await fetch(`${WORKER_BASE_URL}/api/observations/batch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(params),
            });

            if (!response.ok) {
              return { error: `Fetch failed: ${response.status}` };
            }

            return await response.json();
          } catch (error) {
            return { error: `Fetch error: ${error instanceof Error ? error.message : String(error)}` };
          }
        },
      },
    },
  };

  return hooks;
};

export default ClaudeMemPlugin;
