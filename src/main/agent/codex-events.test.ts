import { describe, expect, it } from 'vitest';
import { parseCodexEvent } from './codex-events';

describe('parseCodexEvent', () => {
  it('captures the session id', () => {
    expect(parseCodexEvent('{"type":"thread.started","thread_id":"session-1"}')?.sessionId).toBe('session-1');
  });

  it('upserts command events with stable ids', () => {
    const started = parseCodexEvent(JSON.stringify({ type: 'item.started', item: { id: 'cmd-1', type: 'command_execution', command: 'npm test' } }));
    const completed = parseCodexEvent(JSON.stringify({ type: 'item.completed', item: { id: 'cmd-1', type: 'command_execution', command: 'npm test', aggregated_output: 'ok' } }));
    expect(started?.event).toMatchObject({ id: 'cmd-1', kind: 'command', status: 'running' });
    expect(completed?.event).toMatchObject({ id: 'cmd-1', kind: 'command', status: 'ok', detail: 'ok' });
  });

  it('extracts the final agent message', () => {
    const parsed = parseCodexEvent(JSON.stringify({ type: 'item.completed', item: { id: 'a1', type: 'agent_message', text: 'Done.' } }));
    expect(parsed?.finalText).toBe('Done.');
    expect(parsed?.event?.kind).toBe('text');
  });
});
