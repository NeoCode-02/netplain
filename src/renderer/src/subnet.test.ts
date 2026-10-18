import { describe, expect, it } from 'vitest'
import { contains, subnet } from './subnet'

describe('subnet', () => {
  it('works out an IPv4 network from a prefix or a mask', () => {
    const s = subnet('192.168.1.130/26')
    expect(s).toEqual({ v: 4, prefix: 26, network: '192.168.1.128', first: '192.168.1.129', last: '192.168.1.190', broadcast: '192.168.1.191', hosts: 62n, mask: '255.255.255.192', wildcard: '0.0.0.63' })
    expect(subnet('10.1.2.3 255.255.0.0')?.network).toBe('10.1.0.0')
    expect(subnet(' 10.1.2.3 / 8 ')?.network).toBe('10.0.0.0')
  })

  it('handles the edges: /0, /31, /32', () => {
    expect(subnet('8.8.8.8/0')).toMatchObject({ network: '0.0.0.0', broadcast: '255.255.255.255', hosts: 4294967294n, mask: '0.0.0.0' })
    expect(subnet('10.0.0.1/31')).toMatchObject({ first: '10.0.0.0', last: '10.0.0.1', broadcast: null, hosts: 2n })
    expect(subnet('10.0.0.1/32')).toMatchObject({ first: '10.0.0.1', last: '10.0.0.1', hosts: 1n })
  })

  it('works out IPv6 ranges and writes them short', () => {
    expect(subnet('2001:DB8:0:0:1::1/64')).toMatchObject({ v: 6, network: '2001:db8::', first: '2001:db8::', last: '2001:db8::ffff:ffff:ffff:ffff', hosts: 18446744073709551616n, mask: null })
    expect(subnet('::/0')?.last).toBe('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
    expect(subnet('2001:db8:0:1:0:0:0:1/128')?.network).toBe('2001:db8:0:1::1')
    expect(subnet('::ffff:192.168.1.1/120')?.network).toBe('::ffff:c0a8:100')
  })

  it('rejects what is not a subnet', () => {
    for (const bad of ['192.168.1.1', '192.168.1.1/33', '192.168.1.256/24', '10.0.0.1 255.0.255.0', '1:2:3/64', '1::2::3/64', 'abc/8', '10.0.0.1/24 x', '2001:db8::/129', '2001:db8::1 255.255.0.0']) expect(subnet(bad), bad).toBeNull()
  })

  it('tells whether an address is inside', () => {
    const s = subnet('192.168.1.0/24')!
    expect(contains(s, '192.168.1.200')).toBe(true)
    expect(contains(s, '192.168.2.1')).toBe(false)
    expect(contains(s, '2001:db8::1')).toBeNull()
    expect(contains(subnet('2001:db8::/32')!, '2001:db8:ffff::1')).toBe(true)
  })
})
