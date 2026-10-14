import { expect, it } from 'vitest'
import { isPrivate, realDevices } from './net'
import { parseManuf } from './tshark'

it('keeps real devices only', () => {
  const n = (ip: string, mac: string) => ({ ip, mac, via: 'x', vendor: null })
  const list = [n('192.168.0.1', 'a4:2b:b0:11:22:33'), n('192.168.0.255', 'ff:ff:ff:ff:ff:ff'), n('224.0.0.251', '01:00:5e:00:00:fb'), n('239.255.255.250', '01:00:5e:7f:ff:fa'), n('192.168.0.9', '')]
  expect(realDevices(list).map((d) => d.ip)).toEqual(['192.168.0.1'])
})

it('scans private networks only', () => {
  expect(['10.1.2.3', '172.16.0.1', '172.31.9.9', '192.168.0.102'].every(isPrivate)).toBe(true)
  expect(['8.8.8.8', '172.32.0.1', '100.64.0.1', '169.254.1.1'].some(isPrivate)).toBe(false)
})

it('reads Wireshark’s manufacturer list', () => {
  const m = parseManuf('00:00:00         \t00:00:00    \tOfficially Xerox\nA4:2B:B0         \tTpLinkTechno\tTp-Link Technologies Co.,Ltd.\n00:1B:C5:00:00/36\tConverging\tConverging Systems Inc.\nE8:BF:B8         \tIntel       \n')
  expect(m.get('a4:2b:b0')).toBe('Tp-Link Technologies Co.,Ltd.')
  expect(m.get('e8:bf:b8')).toBe('Intel')
  expect(m.size).toBe(3)
})
