import { describe, expect, it } from 'vitest';
import { parseClaudeMessage } from './claude-events';

describe('parseClaudeMessage', () => {
  it('maps edits into renderer events', () => {
    const parsed = parseClaudeMessage({
      type: 'assistant', session_id: 's1', uuid: 'm1',
      message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Edit', input: { file_path: 'src/App.tsx' } }] },
    });
    expect(parsed.sessionId).toBe('s1');
    expect(parsed.event).toMatchObject({ id: 'tool-1', kind: 'edit', status: 'running' });
  });

  it('maps successful results', () => {
    const parsed = parseClaudeMessage({ type: 'result', subtype: 'success', session_id: 's1', uuid: 'r1', result: 'Finished' });
    expect(parsed.finalText).toBe('Finished');
    expect(parsed.event).toMatchObject({ kind: 'text', status: 'ok' });
  });
});
