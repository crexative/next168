import type { AssistantProvider, Availability } from './provider'

export type ProviderChoice = 'rules' | 'webllm'

export interface ProviderStatus {
  id: ProviderChoice
  availability: Availability
}

// The requested provider is honoured only while it can answer now (a pending download cannot); the rules provider is the floor.
export function selectProvider(requested: ProviderChoice, statuses: ProviderStatus[]): ProviderChoice {
  const status = statuses.find((entry) => entry.id === requested)
  return status?.availability === 'available' ? requested : 'rules'
}

export async function statusOf(providers: Record<ProviderChoice, AssistantProvider>): Promise<ProviderStatus[]> {
  return Promise.all((Object.keys(providers) as ProviderChoice[]).map(async (id) => ({ id, availability: await providers[id].availability() })))
}
