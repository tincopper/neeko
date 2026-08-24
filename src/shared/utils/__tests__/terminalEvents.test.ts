import { describe, expect, it } from 'vitest';

import {
  TERMINAL_CLOSED_EVENT,
  TERMINAL_INPUT_EVENT,
  TERMINAL_OUTPUT_EVENT,
  terminalClosedEvent,
  terminalInputEvent,
  terminalOutputEvent,
} from '../terminalEvents';

describe('terminal event helpers', () => {
  it('builds input/output/closed event names from their shared prefixes', () => {
    expect(terminalInputEvent('pty-1')).toBe(`${TERMINAL_INPUT_EVENT}-pty-1`);
    expect(terminalOutputEvent('pty-1')).toBe(`${TERMINAL_OUTPUT_EVENT}-pty-1`);
    expect(terminalClosedEvent('pty-1')).toBe(`${TERMINAL_CLOSED_EVENT}-pty-1`);
  });
});
