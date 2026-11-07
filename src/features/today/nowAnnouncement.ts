import { computed, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { announce } from '@/ui/announcer'
import { displayLocale } from '@/ui/format'
import { formatTime } from '@/features/week/localTime'
import { untilClock } from './clockPhrase'
import type { NowState } from './nowState'

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string

interface Announcement {
  // Set when the primary item changed: its title and, when known, the clock time it ends.
  changed?: { title: string; until?: string }
  // Set when a "how did it go?" question just became available: the block it is about.
  askTitle?: string
}

// One spoken message per refresh: a change of Now and a new question on the same refresh read as one sentence.
export function nowAnnouncement(t: Translate, { changed, askTitle }: Announcement): string {
  const parts: string[] = []
  if (changed) {
    parts.push(changed.until
      ? untilClock(t as never, 'today.now.changed', changed.until, { title: changed.title })
      : t('today.now.changedOpen', { title: changed.title }))
  }
  if (askTitle) parts.push(t('today.now.askAvailable', { title: askTitle }))
  return parts.join('. ')
}

const askedKey = (state: NowState): string => state.action?.kind === 'ask' ? `${state.action.occurrence.blockId}@${state.action.occurrence.start}` : ''

// Tells a screen reader when Now changes or a question becomes available, once per boundary. The first render is
// not announced (the shell reads the page title), nor is anything while the tab is hidden or on the refresh that
// brings it back: the change is recorded silently. `ready` is false until the planner is loaded, so the state that
// appears when it arrives is the first render, not a change.
export function useNowAnnouncements(state: Ref<NowState>, timeZone: Ref<string>, ready: Ref<boolean>): void {
  const { t } = useI18n()
  const asked = computed(() => askedKey(state.value))
  let returning = false
  let resetReturning: ReturnType<typeof setTimeout> | undefined
  // What Today last announced or rendered; undefined until the first render.
  let seen: { key: string; ask: string } | undefined

  function onVisibility(): void {
    if (document.visibilityState !== 'visible') return
    returning = true
    clearTimeout(resetReturning)
    resetReturning = setTimeout(() => { returning = false }, 0)
  }
  onMounted(() => document.addEventListener('visibilitychange', onVisibility))
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibility)
    clearTimeout(resetReturning)
  })

  watch([ready, () => state.value.key, asked], ([isReady, key, ask]) => {
    if (!isReady) return
    const previous = seen
    seen = { key, ask }
    if (!previous || document.visibilityState === 'hidden' || returning) return
    const current = state.value
    const changed = key !== previous.key
      ? {
          title: current.primary?.title ?? t('today.now.free'),
          until: current.endsAt ? formatTime(current.endsAt, displayLocale.value, timeZone.value) : undefined,
        }
      : undefined
    const askTitle = ask !== '' && ask !== previous.ask && current.action?.kind === 'ask' ? current.action.occurrence.title : undefined
    const message = nowAnnouncement(t, { changed, askTitle })
    if (message) announce(message)
  }, { immediate: true })
}
