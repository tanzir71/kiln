import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { delimiter } from 'node:path';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export function killProcessTree(child: ChildProcess): void {
  if (!child.pid || child.killed) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}

export async function runCommand(command: string, args: string[], options: RunOptions = {}): Promise<CommandResult> {
  if (options.signal?.aborted) throw new DOMException('Run cancelled', 'AbortError');
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let stdoutRemainder = '';
    let stderrRemainder = '';
    let timedOut = false;

    const emitLines = (chunk: Buffer, kind: 'stdout' | 'stderr') => {
      const text = chunk.toString();
      if (kind === 'stdout') {
        stdout += text;
        const parts = (stdoutRemainder + text).split(/\r?\n/);
        stdoutRemainder = parts.pop() ?? '';
        parts.forEach((line) => options.onStdoutLine?.(line));
      } else {
        stderr += text;
        const parts = (stderrRemainder + text).split(/\r?\n/);
        stderrRemainder = parts.pop() ?? '';
        parts.forEach((line) => options.onStderrLine?.(line));
      }
    };
    child.stdout.on('data', (chunk: Buffer) => emitLines(chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => emitLines(chunk, 'stderr'));

    const abort = () => killProcessTree(child);
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = options.timeoutMs ? setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, options.timeoutMs) : undefined;

    child.once('error', reject);
    child.once('close', (code) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (stdoutRemainder) options.onStdoutLine?.(stdoutRemainder);
      if (stderrRemainder) options.onStderrLine?.(stderrRemainder);
      if (options.signal?.aborted) return reject(new DOMException('Run cancelled', 'AbortError'));
      if (timedOut) return reject(new Error(`${command} timed out`));
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function findExecutable(name: string, candidates: string[] = []): Promise<string | undefined> {
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* keep looking */ }
  }
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = `${directory}/${name}`;
    try { await access(candidate); return candidate; } catch { /* keep looking */ }
  }
  return undefined;
}

export class ProcessSupervisor {
  private readonly children = new Map<string, ChildProcess>();

  start(key: string, command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): ChildProcess {
    this.stop(key);
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: 'pipe',
      detached: process.platform !== 'win32',
    });
    this.children.set(key, child);
    child.once('close', () => {
      if (this.children.get(key) === child) this.children.delete(key);
    });
    return child;
  }

  has(key: string): boolean { return this.children.has(key); }

  stop(key: string): void {
    const child = this.children.get(key);
    if (child) killProcessTree(child);
    this.children.delete(key);
  }

  stopAll(): void {
    for (const child of this.children.values()) killProcessTree(child);
    this.children.clear();
  }
}
