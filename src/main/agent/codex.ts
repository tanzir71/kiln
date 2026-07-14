import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentEngine } from './types';
import { event } from './types';
import { parseCodexEvent } from './codex-events';
import { findExecutable, runCommand } from '../util/process';

export class CodexDriver implements AgentEngine {
  readonly id;
  constructor(byok: boolean) { this.id = byok ? 'codex-byok' as const : 'codex-sub' as const; }

  private async binary(): Promise<string | undefined> {
    return await findExecutable('codex', [join(homedir(), '.local/bin/codex')]);
  }

  async checkAvailable(): Promise<{ ok: boolean; reason?: string; version?: string }> {
    const binary = await this.binary();
    if (!binary) return { ok: false, reason: 'Codex CLI not found. Install it with `npm install -g @openai/codex`.' };
    const version = await runCommand(binary, ['--version']);
    if (version.code !== 0) return { ok: false, reason: version.stderr.trim() || 'Codex CLI failed to start' };
    if (this.id === 'codex-sub') {
      const login = await runCommand(binary, ['login', 'status']);
      if (login.code !== 0 || !/logged in/i.test(`${login.stdout}\n${login.stderr}`)) {
        return { ok: false, reason: 'Run `codex login` to sign in with ChatGPT.', version: version.stdout.trim().replace(/^codex-cli\s+/i, '') };
      }
    }
    return { ok: true, version: version.stdout.trim().replace(/^codex-cli\s+/i, '') };
  }

  async run(opts: Parameters<AgentEngine['run']>[0]): ReturnType<AgentEngine['run']> {
    const binary = await this.binary();
    if (!binary) throw new Error('Codex CLI is not installed');
    const prompt = opts.mode === 'plan'
      ? `PLAN MODE: Produce a concrete implementation plan only. Do not edit files or run mutating commands.\n\n${opts.prompt}`
      : opts.prompt;
    const args = opts.sessionId
      ? ['exec', 'resume', '--json', ...(opts.model ? ['--model', opts.model] : []), opts.sessionId, prompt]
      : ['exec', '--json', '--cd', opts.cwd, '--sandbox', opts.mode === 'plan' ? 'read-only' : 'workspace-write', ...(opts.model ? ['--model', opts.model] : []), prompt];
    let sessionId = opts.sessionId ?? '';
    let finalText = '';
    const result = await runCommand(binary, args, {
      cwd: opts.cwd,
      signal: opts.abortSignal,
      env: this.id === 'codex-byok' && opts.apiKey ? { CODEX_API_KEY: opts.apiKey } : undefined,
      onStdoutLine: (line) => {
        const parsed = parseCodexEvent(line);
        if (parsed?.sessionId) sessionId = parsed.sessionId;
        if (parsed?.finalText) finalText = parsed.finalText;
        if (parsed?.event) opts.onEvent(parsed.event);
      },
      onStderrLine: (line) => {
        if (line.trim()) opts.onEvent(event('thinking', 'Codex', 'running', line));
      },
    });
    if (result.code !== 0) {
      opts.onEvent(event('error', 'Codex exited with an error', 'fail', result.stderr || result.stdout));
    } else if (finalText) {
      opts.onEvent(event('text', 'Codex finished', 'ok', finalText));
    }
    return { sessionId, exitCode: result.code };
  }
}
