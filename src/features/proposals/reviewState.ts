import { ref, shallowRef } from 'vue'
import type { ChangeProposal } from '@/core/model'

// What the review sheet shows and what the last decision was. Plain refs so any view can follow them.
export const reviewing = shallowRef<ChangeProposal | null>(null)
export const lastDecision = ref<{ kind: 'applied' | 'rejected'; id: string; tick: number } | null>(null)
