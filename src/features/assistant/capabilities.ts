export interface DeviceCapabilities {
  webGpu: boolean
  shaderF16: boolean
  maxBufferSize: number | undefined
  deviceMemoryGb: number | undefined
  storageQuotaBytes: number | undefined
  storageUsageBytes: number | undefined
}

interface GpuAdapterLike { features: { has(name: string): boolean }; limits: { maxBufferSize?: number } }
type NavigatorWithGpu = Navigator & {
  gpu?: { requestAdapter(): Promise<GpuAdapterLike | null> }
  deviceMemory?: number
}

const NONE: DeviceCapabilities = {
  webGpu: false, shaderF16: false, maxBufferSize: undefined, deviceMemoryGb: undefined,
  storageQuotaBytes: undefined, storageUsageBytes: undefined,
}

// Runs when the assistant is opened, never at app load.
export async function probeCapabilities(nav: NavigatorWithGpu = navigator): Promise<DeviceCapabilities> {
  const storage = await nav.storage?.estimate?.().catch(() => undefined)
  const base = { ...NONE, deviceMemoryGb: nav.deviceMemory, storageQuotaBytes: storage?.quota, storageUsageBytes: storage?.usage }
  if (!nav.gpu) return base
  try {
    const adapter = await nav.gpu.requestAdapter()
    if (!adapter) return base
    return { ...base, webGpu: true, shaderF16: adapter.features.has('shader-f16'), maxBufferSize: adapter.limits.maxBufferSize }
  } catch {
    return base
  }
}
