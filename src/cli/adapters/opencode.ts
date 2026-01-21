/**
 * OpenCode Platform Adapter
 *
 * Transforms OpenCode plugin events to normalized format for claude-mem handlers.
 *
 * Unlike Claude Code/Cursor which use stdin/stdout JSON, OpenCode provides
 * structured objects directly in event callbacks.
 */

import type { PlatformAdapter, NormalizedHookInput, HookResult } from '../types.js';

/**
 * OpenCode chat message input structure
 */
export interface OpenCodeChatInput {
  sessionId: string;
  prompt: string;
}

/**
 * OpenCode tool execution input structure
 */
export interface OpenCodeToolInput {
  sessionId: string;
  toolName: string;
  toolInput: unknown;
  toolOutput: unknown;
}

/**
 * OpenCode system transform input structure
 */
export interface OpenCodeSystemTransformInput {
  sessionId: string;
  cwd: string;
}

/**
 * OpenCode session compacting input structure
 */
export interface OpenCodeCompactingInput {
  sessionId: string;
  messages: unknown[];
}

export const opencodeAdapter: PlatformAdapter = {
  /**
   * Normalize OpenCode event input to common format
   *
   * OpenCode provides structured objects directly, so we map fields
   * to the normalized format used by all handlers.
   */
  normalizeInput(raw: unknown): NormalizedHookInput {
    const r = raw as Record<string, unknown>;
    return {
      sessionId: (r.sessionId as string) ?? 'unknown',
      cwd: (r.cwd as string) ?? (r.directory as string) ?? process.cwd(),
      platform: 'opencode',
      prompt: r.prompt as string | undefined,
      toolName: r.toolName as string | undefined,
      toolInput: r.toolInput,
      toolResponse: r.toolOutput ?? r.toolResponse,
      transcriptPath: undefined, // OpenCode doesn't use transcript files
    };
  },

  /**
   * Format handler result for OpenCode
   *
   * OpenCode uses output mutation rather than return values for most hooks.
   * For context injection, we return the context string directly.
   */
  formatOutput(result: HookResult): unknown {
    // For context injection hooks, return the context string
    if (result.hookSpecificOutput?.additionalContext) {
      return result.hookSpecificOutput.additionalContext;
    }
    // For other hooks, return success status
    return { success: result.continue ?? true };
  },
};
