import { homedir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEngine } from './types';
import { event } from './types';
import { parseClaudeJsonLine, parseClaudeMessage } from './claude-events';
import { findExecutable, runCommand } from '../util/process';

const ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];

export class ClaudeSubscriptionDriver implements AgentEngine {
  readonly id = 'claude-sub' as const;

  private async binary(): Promise<string | undefined> {
    return await findExecutable('claude', [join(homedir(), '.claude/local/claude')]);
  }

  async checkAvailable(): Promise<{ ok: boolean; reason?: string; version?: string }> {
    const binary = await this.binary();
    if (!binary) return { ok: false, reason: 'Claude Code not found. Install it with `npm install -g @anthropic-ai/claude-code`, then run `claude` to sign in.' };
    const version = await runCommand(binary, ['--version']);
    if (version.code !== 0) return { ok: false, reason: version.stderr.trim() || 'Claude Code failed to start' };
    const auth = await runCommand(binary, ['auth', 'status', '--json']);
    if (auth.code === 0 && /"loggedIn"\s*:\s*false/.test(auth.stdout)) {
      return { ok: false, reason: 'Run `claude` in Terminal to sign in.', version: version.stdout.trim() };
    }
    return { ok: true, version: version.stdout.trim() };
  }

  async run(opts: Parameters<AgentEngine['run']>[0]): ReturnType<AgentEngine['run']> {
    const binary = await this.binary();
    if (!binary) throw new Error('Claude Code is not installed');
    const args = [
      '-p', opts.prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', opts.mode === 'plan' ? 'plan' : 'acceptEdits',
      '--add-dir', opts.cwd,
      '--allowedTools', ALLOWED_TOOLS.join(','),
      ...(opts.model ? ['--model', opts.model] : []),
      ...(opts.sessionId ? ['--resume', opts.sessionId] : []),
    ];
    let sessionId = opts.sessionId ?? '';
    const result = await runCommand(binary, args, {
      cwd: opts.cwd,
      signal: opts.abortSignal,
      onStdoutLine: (line) => {
        const parsed = parseClaudeJsonLine(line);
        if (parsed?.sessionId) sessionId = parsed.sessionId;
        if (parsed?.event) opts.onEvent(parsed.event);
      },
      onStderrLine: (line) => line.trim() && opts.onEvent(event('thinking', 'Claude', 'running', line)),
    });
    return { sessionId, exitCode: result.code };
  }
}

export class ClaudeByokDriver implements AgentEngine {
  readonly id = 'claude-byok' as const;

  async checkAvailable(): Promise<{ ok: boolean; reason?: string; version?: string }> {
    return { ok: true, version: 'Agent SDK' };
  }

  async run(opts: Parameters<AgentEngine['run']>[0]): ReturnType<AgentEngine['run']> {
    if (!opts.apiKey) throw new Error('An Anthropic API key is required');
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    opts.abortSignal.addEventListener('abort', abort, { once: true });
    let sessionId = opts.sessionId ?? '';
    let exitCode = 0;
    try {
      const stream = query({
        prompt: opts.prompt,
        options: {
          cwd: opts.cwd,
          abortController,
          resume: opts.sessionId,
          model: opts.model,
          permissionMode: opts.mode === 'plan' ? 'plan' : 'acceptEdits',
          tools: ALLOWED_TOOLS,
          allowedTools: ALLOWED_TOOLS,
          env: { ...process.env, ANTHROPIC_API_KEY: opts.apiKey, CLAUDE_AGENT_SDK_CLIENT_APP: 'kiln/0.1.0' },
        },
      });
      for await (const message of stream) {
        const parsed = parseClaudeMessage(message);
        if (parsed.sessionId) sessionId = parsed.sessionId;
        if (parsed.event) opts.onEvent(parsed.event);
        if (message.type === 'result' && message.subtype !== 'success') exitCode = 1;
      }
    } finally {
      opts.abortSignal.removeEventListener('abort', abort);
    }
    return { sessionId, exitCode };
  }
}
