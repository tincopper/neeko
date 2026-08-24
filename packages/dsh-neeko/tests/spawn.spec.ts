import { describe, expect, it } from 'vitest'
import { spawnNeeko } from '../src/index.ts'

function capture(): { write(chunk: string): void; text: string } {
  let text = ''
  return {
    write: (chunk: string) => { text += chunk },
    get text() { return text },
  }
}

describe('spawnNeeko', () => {
  it('reports a missing spawn command', () => {
    const stderr = capture()
    spawnNeeko('ws://127.0.0.1:3081/ws', 'dsh-agent', '   ', stderr)
    expect(stderr.text).toContain('no Neeko spawn command configured')
  })

  it('reports a failed spawn to the diagnostic sink', async () => {
    const stderr = capture()
    spawnNeeko('ws://127.0.0.1:3081/ws', 'dsh-agent', 'definitely-not-a-real-neeko-binary-xyz', stderr)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(stderr.text).toContain('failed to spawn Neeko')
  })
})
