<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DayIndex } from '@/core/model'
import Icon from '@/ui/Icon.vue'
import { useSetupFormat } from './useSetupFormat'

const props = defineProps<{ days: DayIndex[] }>()
const emit = defineEmits<{ change: [days: DayIndex[]]; done: [] }>()
const { t, locale, weekStartsOn } = useSetupFormat()

const PRESETS: { id: 'weekdays' | 'everyDay' | 'weekend'; days: DayIndex[] }[] = [
  { id: 'weekdays', days: [1, 2, 3, 4, 5] },
  { id: 'everyDay', days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'weekend', days: [6, 0] },
]
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()
const matching = computed(() => PRESETS.find((preset) => same(preset.days, props.days))?.id)
// "Choose days" is the answer when no preset matches, and it keeps the seven toggles open.
const picking = ref(matching.value === undefined)

const options = computed(() => Array.from({ length: 7 }, (_, index) => ((index + weekStartsOn.value) % 7) as DayIndex).map((day) => ({
  day,
  short: new Intl.DateTimeFormat(locale.value, { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(2024, 0, 7 + day)),
  long: new Intl.DateTimeFormat(locale.value, { weekday: 'long', timeZone: 'UTC' }).format(Date.UTC(2024, 0, 7 + day)),
})))

function choose(preset: (typeof PRESETS)[number]): void {
  picking.value = false
  emit('change', [...preset.days])
  emit('done')
}

function toggle(day: DayIndex): void {
  emit('change', props.days.includes(day) ? props.days.filter((item) => item !== day) : [...props.days, day])
}
</script>

<template>
  <div class="days" role="group" :aria-label="t('onboarding.guided.range.days')">
    <div class="presets">
      <button
        v-for="preset in PRESETS"
        :key="preset.id"
        class="pick t-body"
        type="button"
        :data-preset="preset.id"
        :aria-pressed="!picking && matching === preset.id"
        @click="choose(preset)"
      >
        <Icon v-if="!picking && matching === preset.id" name="check" :size="18" />
        {{ t(`onboarding.guided.days.${preset.id}`) }}
      </button>
      <button class="pick t-body" type="button" data-preset="pick" :aria-pressed="picking" :aria-expanded="picking" @click="picking = true">
        <Icon v-if="picking" name="check" :size="18" />
        {{ t('onboarding.guided.days.pick') }}
      </button>
    </div>
    <div v-if="picking" class="toggles">
      <button
        v-for="option in options"
        :key="option.day"
        class="toggle t-body"
        type="button"
        :data-day="option.day"
        :aria-pressed="days.includes(option.day)"
        :aria-label="option.long"
        @click="toggle(option.day)"
      >
        <Icon v-if="days.includes(option.day)" name="check" :size="16" />
        <span>{{ option.short }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.days { display: flex; flex-direction: column; gap: var(--space-2); }
.presets { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.pick, .toggle {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-1); min-width: var(--tap-target); min-height: var(--tap-target);
  padding: var(--space-2) var(--space-3); border: 2px solid var(--field-border); border-radius: var(--radius-control); background: var(--surface);
  color: var(--label); font-weight: 600; touch-action: manipulation; overflow-wrap: anywhere; hyphens: auto;
}
.pick[aria-pressed='true'], .toggle[aria-pressed='true'] { border-color: var(--tint); background: color-mix(in srgb, var(--tint) 14%, transparent); color: var(--tint-label); }
/* Seven toggles wrap to 4 + 3 on a phone (3 + 3 + 1 at 320 px), each wide enough for the check and the short day name
   side by side, so a chosen day never splits its name ("lu / n"). */
.toggles { display: grid; grid-template-columns: repeat(auto-fit, minmax(max(var(--tap-target), 3.75em), 1fr)); gap: var(--control-gap); }
.toggle { padding-inline: var(--space-1); }
</style>
