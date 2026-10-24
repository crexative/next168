<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DayIndex, TimeBlock } from '@/core/model'
import { localDateOf } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import EmptyState from '@/ui/EmptyState.vue'
import Icon from '@/ui/Icon.vue'
import { useUndoToast } from '@/ui/undoToast'
import { useMediaQuery } from '@/ui/useMediaQuery'
import { defaultTaskCategoryId } from '@/features/onboarding/templates'
import BlockEditorSheet from './BlockEditorSheet.vue'
import DayPager from './DayPager.vue'
import WeekGrid from './WeekGrid.vue'
import { removeBlock, restoreBlock, upsertBlock, type BlockDraft } from './blockEditing'
import { useExternalOccurrences } from './externalOccurrences'
import { dayIndexOf, localMinuteOf, weekDates } from './localTime'
import { scrollToNow } from './scrollToNow'
import { useNow } from './useNow'
import { HOUR_HEIGHT_PX, blockSegmentsByDate, busySegmentsByDate } from './weekLayout'

const DEFAULT_BLOCK_MINUTES = 60

const { t } = useI18n()
const planner = usePlannerStore()
const undoToast = useUndoToast()
const isWide = useMediaQuery('(min-width: 768px)')
const now = useNow()

const document = computed(() => planner.document)
const timeZone = computed(() => document.value?.settings.timeZone ?? 'UTC')
const today = computed(() => localDateOf(now.value, timeZone.value))
const dates = computed(() => weekDates(today.value, document.value?.settings.weekStartsOn ?? 1))
const nowMinute = computed(() => localMinuteOf(now.value, timeZone.value))
const external = useExternalOccurrences(() => document.value ? { fromDate: dates.value[0]!, days: 7, timeZone: timeZone.value } : null)
const segments = computed(() => document.value ? blockSegmentsByDate(document.value, dates.value, timeZone.value) : {})
const busy = computed(() => busySegmentsByDate(external.value, document.value?.events ?? [], dates.value, timeZone.value))
const blockCount = computed(() => document.value?.blocks.length ?? 0)
const hasCategories = computed(() => (document.value?.categories.length ?? 0) > 0)

const pagerIndex = ref(Math.max(0, dates.value.indexOf(today.value)))
watch(dates, (next, previous) => {
  if (next[0] !== previous[0]) pagerIndex.value = Math.max(0, next.indexOf(today.value))
})

// Open on the current hour once the grid is first shown; later changes keep the reader's position.
const root = ref<HTMLElement | null>(null)
const hasGrid = computed(() => document.value !== null && hasCategories.value && blockCount.value > 0)
let positioned = false
watch(hasGrid, async (shown) => {
  if (!shown || positioned) return
  await nextTick()
  const line = root.value?.querySelector('[data-testid="now-line"]')
  if (!line) return
  positioned = true
  scrollToNow(line)
}, { immediate: true, flush: 'post' })

const editorOpen = ref(false)
const saveError = ref<string | null>(null)
const saving = ref(false)
const draft = ref<BlockDraft>({ title: '', categoryId: '', start: null, end: null, days: [] })

function openNew(date: string, start: number): void {
  if (!document.value || !planner.writable || !hasCategories.value) return
  saveError.value = null
  draft.value = {
    title: '', categoryId: defaultTaskCategoryId(document.value.categories, ''),
    start, end: (start + DEFAULT_BLOCK_MINUTES) % 1440, days: [dayIndexOf(date)],
  }
  editorOpen.value = true
}

function openNewFromButton(): void {
  const date = isWide.value ? today.value : dates.value[pagerIndex.value] ?? today.value
  const nextHour = Math.min(23, Math.floor(nowMinute.value / 60) + 1) * 60
  openNew(date, date === today.value ? nextHour : 9 * 60)
}

function openExisting(blockId: string): void {
  const block = document.value?.blocks.find((item) => item.id === blockId)
  if (!block || !planner.writable) return
  saveError.value = null
  draft.value = { id: block.id, title: block.title, categoryId: block.categoryId, start: block.start, end: block.end, days: [...block.days] as DayIndex[] }
  editorOpen.value = true
}

async function save(block: TimeBlock): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    const toSave = draft.value.id ? block : { ...block, id: crypto.randomUUID() }
    const result = await planner.commit((next) => upsertBlock(next, toSave))
    if (result.ok) editorOpen.value = false
    else saveError.value = result.reason
  } finally {
    saving.value = false
  }
}

async function remove(blockId: string): Promise<void> {
  const blocks = document.value?.blocks ?? []
  const index = blocks.findIndex((block) => block.id === blockId)
  const block = blocks[index]
  if (!block) return
  editorOpen.value = false
  const result = await planner.commit((next) => removeBlock(next, blockId))
  if (!result.ok) return
  undoToast.show({
    message: t('week.deleted', { title: block.title }),
    onUndo: () => { void planner.commit((next) => restoreBlock(next, block, index)) },
  })
}
</script>

<template>
  <div v-if="document" ref="root" class="week-view" :style="{ '--hour-height': `${HOUR_HEIGHT_PX}px` }">
    <p class="visually-hidden" data-testid="block-count" :data-count="blockCount">{{ t('week.summary', { count: blockCount }, blockCount) }}</p>
    <Teleport v-if="hasCategories && planner.writable" to="#toolbar-actions" defer>
      <button type="button" class="add-button" :aria-label="t('week.add')" @click="openNewFromButton">
        <Icon name="plus" :size="24" />
      </button>
    </Teleport>

    <EmptyState v-if="!hasCategories" icon="calendar-days" :title="t('week.empty.noCategoriesTitle')" :description="t('week.empty.noCategoriesDescription')">
      <a class="empty-link t-headline" href="#/settings">{{ t('week.empty.openSettings') }}</a>
    </EmptyState>
    <EmptyState v-else-if="blockCount === 0" icon="calendar-days" :title="t('week.empty.noBlocksTitle')" :description="t('week.empty.noBlocksDescription')">
      <Button :disabled="!planner.writable" @click="openNewFromButton">{{ t('week.empty.addBlock') }}</Button>
    </EmptyState>
    <template v-else>
      <WeekGrid
        v-if="isWide"
        :dates="dates"
        :today="today"
        :segments="segments"
        :busy="busy"
        :categories="document.categories"
        :time-zone="timeZone"
        :now-minute="nowMinute"
        :editable="planner.writable"
        @select="openExisting"
        @create="openNew"
      />
      <DayPager
        v-else
        v-model:index="pagerIndex"
        :dates="dates"
        :today="today"
        :segments="segments"
        :busy="busy"
        :categories="document.categories"
        :time-zone="timeZone"
        :now-minute="nowMinute"
        :editable="planner.writable"
        @select="openExisting"
        @create="openNew"
      />
    </template>

    <BlockEditorSheet
      v-model:open="editorOpen"
      :draft="draft"
      :document="document"
      :save-error="saveError"
      :saving="saving"
      @save="save"
      @delete="remove"
    />
  </div>
</template>

<style scoped>
.add-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--tap-target);
  height: var(--tap-target);
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--tint-label);
  transition: transform 0.1s var(--ease-out);
}
.add-button:active { transform: scale(0.97); }
.empty-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap-target);
  color: var(--tint-label);
}
@media (prefers-reduced-motion: reduce) {
  .add-button:active { transform: none; opacity: 0.7; }
}
</style>
