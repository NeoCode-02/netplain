import { describe, expect, it } from 'vitest'
import { newer } from './update'

describe('newer', () => {
  it('compares versions part by part', () => {
    expect(newer('v0.2.0', '0.1.0')).toBe(true)
    expect(newer('0.10.0', '0.9.9')).toBe(true)
    expect(newer('v0.1.0', '0.1.0')).toBe(false)
    expect(newer('0.1.0', '0.2.0')).toBe(false)
    expect(newer('1.0.0-beta', '0.9.0')).toBe(true)
  })
})
