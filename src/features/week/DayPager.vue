<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category } from '@/core/model'
import { springTo } from '@/ui/sheetMotion'
import { prefersReducedMotion } from '@/ui/useMediaQuery'
import DayColumn from './DayColumn.vue'
import TimeAxis from './TimeAxis.vue'
import { dragOffset, horizontalVelocity, targetIndex, type PointerSample } from './dayPager'
import { formatDate } from './localTime'
import type { BusyDetails } from './busyDetails'
import type { BlockSegment, BusySegment } from './weekLayout'

const props = defineProps<{
  dates: string[]
  today: string
  segments: Record<string, BlockSegment[]>
  busy: Record<string, BusySegment[]>
  categories: Category[]
  timeZone: string
  nowMinute: number
  editable: boolean
}>()
const emit = defineEmits<{ select: [blockId: string]; create: [date: string, minute: number]; inspect: [details: BusyDetails] }>()
const index = defineModel<number>('index', { required: true })

const { t, locale } = useI18n()
const viewport = ref<HTMLElement | null>(null)
const track = ref<HTMLElement | null>(null)
const fading = ref(false)

const AXIS_LOCK_PX = 8
const FLICK_VELOCITY_PX_PER_S = 500

let offset = 0
let animation: { stop(): void } | undefined
let gesture: { pointerId: number; startX: number; startY: number; baseOffset: number; axis: 'pending' | 'x'; width: number; samples: PointerSample[] } | undefined
let suppressClick = false

// The model index only follows a change once the parent has re-rendered, so a settle passes its target explicitly.
function applyOffset(value: number, position = index.value): void {
  offset = value
  const transform = `translateX(calc(${-position * 100}% + ${value}px))`
  if (track.value && track.value.style.transform !== transform) track.value.style.transform = transform
}

function fadeIn(): void {
  fading.value = false
  requestAnimationFrame(() => { fading.value = true })
}

// Moves to a day keeping the visual position continuous, then settles with a spring (or a fade).
function settleOn(next: number, velocity = 0): void {
  animation?.stop()
  const width = viewport.value?.clientWidth ?? 0
  const from = offset + (next - index.value) * width
  index.value = next
  if (prefersReducedMotion()) {
    applyOffset(0, next)
    fadeIn()
    return
  }
  const apply = (value: number) => applyOffset(value, next)
  apply(from)
  const bounce = Math.abs(velocity) > FLICK_VELOCITY_PX_PER_S ? 0.15 : 0
  const run = springTo(from, 0, apply, { velocity, bounce })
  animation = run
  void run.finished.then(() => { if (animation === run) animation = undefined })
}

function onPointerDown(event: PointerEvent): void {
  if (!event.isPrimary || event.button !== 0) return
  suppressClick = false
  animation?.stop()
  animation = undefined
  gesture = {
    pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, baseOffset: offset,
    axis: 'pending', width: viewport.value?.clientWidth ?? 0, samples: [{ time: event.timeStamp, x: event.clientX }],
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!gesture || event.pointerId !== gesture.pointerId) return
  const dx = event.clientX - gesture.startX
  const dy = event.clientY - gesture.startY
  if (gesture.axis === 'pending') {
    if (Math.abs(dy) > AXIS_LOCK_PX && Math.abs(dy) >= Math.abs(dx)) {
      gesture = undefined
      return
    }
    if (Math.abs(dx) <= AXIS_LOCK_PX) return
    gesture.axis = 'x'
    viewport.value?.setPointerCapture(event.pointerId)
  }
  gesture.samples.push({ time: event.timeStamp, x: event.clientX })
  suppressClick = true
  applyOffset(dragOffset(gesture.baseOffset + dx, index.value, props.dates.length, gesture.width))
}

function onPointerUp(event: PointerEvent): void {
  if (!gesture || event.pointerId !== gesture.pointerId) return
  const { axis, samples, width } = gesture
  gesture = undefined
  if (axis !== 'x') {
    if (offset !== 0) settleOn(index.value)
    return
  }
  const velocity = horizontalVelocity([...samples, { time: event.timeStamp, x: event.clientX }])
  settleOn(targetIndex(index.value, offset, velocity, width, props.dates.length), velocity)
}

function onClickCapture(event: MouseEvent): void {
  if (!suppressClick) return
  suppressClick = false
  event.stopPropagation()
  event.preventDefault()
}

function selectDay(next: number): void {
  if (next !== index.value) settleOn(next)
}

// The accessible name starts with the visible text ("M 19") and then spells the day out.
function dayLabel(date: string): string {
  const short = `${formatDate(date, locale.value, { weekday: 'narrow' })} ${formatDate(date, locale.value, { day: 'numeric' })}`
  return `${short}, ${formatDate(date, locale.value, { weekday: 'long', day: 'numeric', month: 'long' })}`
}
watch(index, () => { if (!gesture && !animation) applyOffset(offset) })
onMounted(() => applyOffset(0))
onBeforeUnmount(() => animation?.stop())
</script>

<template>
  <div class="pager" :data-active-date="dates[index]">
    <div class="day-strip" role="group" data-toolbar-extension :aria-label="t('week.pager.days')">
      <button
        v-for="(date, position) in dates"
        :key="date"
        type="button"
        class="strip-day"
        :class="{ 'is-today': date === today }"
        :aria-pressed="position === index"
        :aria-current="date === today ? 'date' : undefined"
        :aria-label="dayLabel(date)"
        @click="selectDay(position)"
      >
        <span class="t-caption strip-weekday">{{ formatDate(date, locale, { weekday: 'narrow' }) }}</span>{{ ' ' }}
        <span class="strip-number">{{ formatDate(date, locale, { day: 'numeric' }) }}</span>
      </button>
    </div>
    <div
      ref="viewport"
      class="pager-viewport"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @click.capture="onClickCapture"
    >
      <div ref="track" class="pager-track" :class="{ 'is-fading': fading }" data-testid="pager-track" @animationend="fading = false">
        <div
          v-for="(date, position) in dates"
          :key="date"
          class="pager-page"
          :inert="position !== index"
          :aria-hidden="position !== index ? 'true' : undefined"
        >
          <TimeAxis />
          <DayColumn
            :date="date"
            :label="formatDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' })"
            :segments="segments[date] ?? []"
            :busy="busy[date] ?? []"
            :categories="categories"
            :time-zone="timeZone"
            :now-minute="date === today ? nowMinute : null"
            :editable="editable"
            @select="(id) => emit('select', id)"
            @create="(day, minute) => emit('create', day, minute)"
            @inspect="(details) => emit('inspect', details)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.day-strip {
  position: sticky;
  top: calc(var(--safe-top) + var(--toolbar-height));
  z-index: 5;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  padding: var(--space-1) var(--space-2);
  background: var(--material);
  -webkit-backdrop-filter: var(--material-filter);
  backdrop-filter: var(--material-filter);
}
.strip-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: var(--tap-target);
  min-height: 3.25rem;
  padding: 0;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--label);
  touch-action: manipulation;
}
.strip-weekday { color: var(--label-2); font-size: min(0.75rem, 15px); }
.strip-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Seven days share the width: like the system calendar, the strip stops growing at large text sizes. */
  width: min(2rem, 40px);
  height: min(2rem, 40px);
  border-radius: 50%;
  font-size: min(1.25rem, 22px);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.is-today .strip-weekday, .is-today .strip-number { color: var(--danger-label); }
.strip-day[aria-pressed='true'] .strip-number { background: var(--label); color: var(--surface); }
.strip-day.is-today[aria-pressed='true'] .strip-number { background: var(--danger); color: #fff; }

.pager-viewport { overflow: hidden; overflow: clip visible; touch-action: pan-y; padding-top: var(--space-2); }
.pager-track { display: flex; will-change: transform; transition-property: none; }
.pager-page {
  display: grid;
  flex: 0 0 100%;
  grid-template-columns: 3.25rem minmax(0, 1fr);
  padding: 0 var(--space-4) var(--space-4) var(--space-2);
}
.pager-track.is-fading { animation: day-fade 0.15s ease-out; }
@keyframes day-fade { from { opacity: 0.35; } }
</style>
