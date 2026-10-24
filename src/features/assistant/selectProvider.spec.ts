import { describe, expect, it } from 'vitest'
import { probeCapabilities } from './capabilities'
import { selectProvider } from './selectProvider'

describe('selectProvider', () => {
  it.each([
    ['webllm', 'available', 'webllm'],
    ['webllm', 'downloadable', 'rules'],
    ['webllm', 'unavailable', 'rules'],
    ['rules', 'available', 'rules'],
  ] as const)('requested %s while the model is %s uses %s', (requested, webllm, expected) => {
    expect(selectProvider(requested, [{ id: 'rules', availability: 'available' }, { id: 'webllm', availability: webllm }])).toBe(expected)
  })
})

describe('probeCapabilities', () => {
  const nav = (overrides: object) => overrides as unknown as Navigator

  it('reports no WebGPU when navigator.gpu is missing', async () => {
    expect((await probeCapabilities(nav({}))).webGpu).toBe(false)
  })

  it('reports no WebGPU when no adapter is returned or the request throws', async () => {
    expect((await probeCapabilities(nav({ gpu: { requestAdapter: async () => null } }))).webGpu).toBe(false)
    expect((await probeCapabilities(nav({ gpu: { requestAdapter: async () => { throw new Error('x') } } }))).webGpu).toBe(false)
  })

  it('reads adapter features, memory and storage', async () => {
    const result = await probeCapabilities(nav({
      gpu: { requestAdapter: async () => ({ features: new Set(['shader-f16']), limits: { maxBufferSize: 123 } }) },
      deviceMemory: 4,
      storage: { estimate: async () => ({ quota: 10, usage: 2 }) },
    }))
    expect(result).toEqual({ webGpu: true, shaderF16: true, maxBufferSize: 123, deviceMemoryGb: 4, storageQuotaBytes: 10, storageUsageBytes: 2 })
  })
})
