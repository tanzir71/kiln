import type { AgentEvent, EngineId, RunMode } from '../../../ui/src/types';

export interface AgentEngine {
  id: EngineId;
  checkAvailable(): Promise<{ ok: boolean; reason?: string; version?: string }>;
  run(opts: {
    cwd: string;
    prompt: string;
    mode: RunMode;
    sessionId?: string;
    model?: string;
    apiKey?: string;
    onEvent: (event: AgentEvent) => void;
    abortSignal: AbortSignal;
  }): Promise<{ sessionId: string; exitCode: number }>;
}

export function event(
  kind: AgentEvent['kind'],
  label: string,
  status: AgentEvent['status'],
  detail?: string,
  id: string = crypto.randomUUID(),
): AgentEvent {
  return { id, kind, label, status, detail, ts: new Date().toISOString() };
}
