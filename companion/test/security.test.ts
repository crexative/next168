import { describe, expect, it } from 'vitest'
import { isPublicAddress, fetchCalendar, resolvePublicTarget } from '../src/calendarFetch'

describe('calendar SSRF boundary', () => {
  it.each(['127.0.0.1', '0.0.0.0', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '2002:7f00:1::', '2001:db8::1'])('rejects %s', address => { expect(isPublicAddress(address)).toBe(false) })
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('accepts public %s', address => { expect(isPublicAddress(address)).toBe(true) })
  it('rejects any private answer, not only the first DNS answer', async () => {
    await expect(resolvePublicTarget(new URL('https://calendar.example/feed'), async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }])).rejects.toThrow('private')
  })
  it('pins the validated address even when DNS would change and strips credentials', async () => {
    let lookups = 0
    const text = await fetchCalendar('https://user:secret@calendar.example/feed', {
      resolve: async () => [{ address: ++lookups === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }],
      request: async (url, target) => {
        expect(target.address).toBe('8.8.8.8'); expect(url.username).toBe(''); expect(url.password).toBe('')
        return { status: 200, text: 'BEGIN:VCALENDAR', location: undefined }
      },
    })
    expect(text).toBe('BEGIN:VCALENDAR'); expect(lookups).toBe(1)
  })
  it('revalidates a redirect to loopback before connecting', async () => {
    let requests = 0
    await expect(fetchCalendar('https://calendar.example/feed', {
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => { requests++; return { status: 302, location: 'http://127.0.0.1/private', text: '' } },
    })).rejects.toThrow('private')
    expect(requests).toBe(1)
  })
  it('rejects unsupported schemes', async () => { await expect(fetchCalendar('file:///etc/passwd')).rejects.toThrow('scheme') })
})
