import { describe, expect, it } from 'vitest'
import {
  PROTOCOL_VERSION,
  isHandshake,
  isNeekoToDsh,
  unwrapEnvelope,
  wrapEnvelope,
  type DshToNeeko,
} from '../src/protocol.ts'

describe('dsh-neeko protocol', () => {
  it('round-trips a message through the envelope', () => {
    const message: DshToNeeko = { type: 'status.change', payload: { status: 'thinking' } }
    const envelope = wrapEnvelope(message, 'dsh->neeko', 'rpc-1')
    expect(envelope.direction).toBe('dsh->neeko')
    expect(envelope.rpcId).toBe('rpc-1')
    expect(envelope.message).toEqual(message)

    const unwrapped = unwrapEnvelope(JSON.parse(JSON.stringify(envelope)))
    expect(unwrapped?.rpcId).toBe('rpc-1')
    expect(unwrapped?.message).toEqual(message)
  })

  it('mints a fresh rpcId when omitted', () => {
    const a = wrapEnvelope({ type: 'status.change', payload: { status: 'idle' } }, 'dsh->neeko')
    const b = wrapEnvelope({ type: 'status.change', payload: { status: 'idle' } }, 'dsh->neeko')
    expect(a.rpcId).toBeTruthy()
    expect(b.rpcId).toBeTruthy()
    expect(a.rpcId).not.toBe(b.rpcId)
  })

  it('accepts a bare message frame (unwrapped)', () => {
    const unwrapped = unwrapEnvelope({ type: 'session.prompt', payload: { sessionId: 's', message: 'hi' } })
    expect(unwrapped?.rpcId).toBeUndefined()
    expect(unwrapped?.message).toEqual({ type: 'session.prompt', payload: { sessionId: 's', message: 'hi' } })
  })

  it('rejects non-object frames', () => {
    expect(unwrapEnvelope(null)).toBeUndefined()
    expect(unwrapEnvelope('nope')).toBeUndefined()
    expect(unwrapEnvelope(42)).toBeUndefined()
  })

  it('validates a handshake', () => {
    const valid = {
      type: 'handshake',
      payload: { version: PROTOCOL_VERSION, role: 'neeko', mode: 'dsh-agent', active: true },
    }
    expect(isHandshake(valid)).toBe(true)
    expect(isHandshake({ ...valid, payload: { ...valid.payload, role: 'other' } })).toBe(false)
    expect(isHandshake({ ...valid, payload: { ...valid.payload, mode: 'weird' } })).toBe(false)
    expect(isHandshake({ ...valid, payload: { ...valid.payload, active: 'yes' } })).toBe(false)
    expect(isHandshake({ type: 'session.prompt', payload: {} })).toBe(false)
  })

  it('recognizes every Neeko->DSH message type', () => {
    for (const message of [
      { type: 'session.prompt', payload: { sessionId: 's', message: 'x' } },
      { type: 'session.steer', payload: { sessionId: 's', message: 'x' } },
      { type: 'session.cancel', payload: { sessionId: 's' } },
      { type: 'approval.respond', payload: { requestId: 'r', decision: 'allowed' } },
      { type: 'question.respond', payload: { requestId: 'r', answer: 'y' } },
    ]) {
      expect(isNeekoToDsh(message)).toBe(true)
    }
    expect(isNeekoToDsh({ type: 'status.change', payload: {} })).toBe(false)
  })
})
