<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { availableLocales, isSupportedLocale, setLocale } from '@/i18n'
import { usePlannerStore } from '@/stores/plannerStore'
import ListGroup from '@/ui/ListGroup.vue'
import { appearance, setAppearance, type Appearance } from '@/ui/appearance'
import { displayLocale, formatClock, hourCycle, setHourCycle, type HourCycle } from '@/ui/format'

// General: language, first day of the week, 12/24 h clock and appearance, set once on the Settings list. One control
// for one kind of choice (R_Ajustes): four value rows, each with the platform's pop-up.
// Language and week start belong to the planner document; the clock and appearance are preferences of this device.
const { t, locale } = useI18n()
const planner = usePlannerStore()
const ids = { language: useId(), week: useId(), clock: useId(), appearance: useId() }

const language = computed(() => isSupportedLocale(planner.document?.settings.locale) ? planner.document!.settings.locale : locale.value)
const weekStart = computed(() => String(planner.document?.settings.weekStartsOn ?? 1) as '0' | '1')

const weekOptions = computed(() => [
  { value: '1' as const, label: t('common.preferences.monday') },
  { value: '0' as const, label: t('common.preferences.sunday') },
])
const clockOptions = computed(() => [
  { value: 'auto' as HourCycle, label: t('common.preferences.clockAuto') },
  { value: 'h12' as HourCycle, label: t('common.preferences.clock12') },
  { value: 'h23' as HourCycle, label: t('common.preferences.clock24') },
])
const appearanceOptions = computed(() => [
  { value: 'auto' as Appearance, label: t('settings.appearance.auto') },
  { value: 'light' as Appearance, label: t('settings.appearance.light') },
  { value: 'dark' as Appearance, label: t('settings.appearance.dark') },
])
// 14:30 in the chosen format, so the choice shows its effect.
const example = computed(() => formatClock(Date.UTC(2000, 0, 1, 14, 30), displayLocale.value, 'UTC'))

async function chooseLanguage(event: Event): Promise<void> {
  const code = (event.target as HTMLSelectElement).value
  if (!isSupportedLocale(code)) return
  setLocale(code)
  await planner.commit((draft) => { draft.settings.locale = code })
}

async function chooseWeekStart(value: '0' | '1'): Promise<void> {
  await planner.commit((draft) => { draft.settings.weekStartsOn = value === '0' ? 0 : 1 })
}
</script>

<template>
  <div v-if="planner.document" class="preferences" data-testid="general-settings">
    <ListGroup :header="t('common.preferences.title')" :footer="t('common.preferences.footer', { example })">
      <li class="preference">
        <label :for="ids.language" class="t-body">{{ t('common.preferences.language') }}</label>
        <select :id="ids.language" class="value t-body" :value="language" :disabled="!planner.writable" data-testid="preference-language" @change="chooseLanguage">
          <option v-for="option in availableLocales" :key="option.code" :value="option.code" :lang="option.code">{{ option.name }}</option>
        </select>
      </li>
      <li class="preference">
        <label :for="ids.week" class="t-body">{{ t('common.preferences.weekStart') }}</label>
        <select :id="ids.week" class="value t-body" :value="weekStart" :disabled="!planner.writable" data-testid="preference-week-start" @change="chooseWeekStart(($event.target as HTMLSelectElement).value as '0' | '1')">
          <option v-for="option in weekOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </li>
      <li class="preference">
        <label :for="ids.clock" class="t-body">{{ t('common.preferences.clock') }}</label>
        <select :id="ids.clock" class="value t-body" :value="hourCycle" data-testid="preference-clock" @change="setHourCycle(($event.target as HTMLSelectElement).value as HourCycle)">
          <option v-for="option in clockOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </li>
      <li class="preference" data-testid="appearance-settings">
        <label :for="ids.appearance" class="t-body">{{ t('settings.appearance.title') }}</label>
        <select :id="ids.appearance" class="value t-body" :value="appearance" data-testid="preference-appearance" @change="setAppearance(($event.target as HTMLSelectElement).value as Appearance)">
          <option v-for="option in appearanceOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </li>
    </ListGroup>
  </div>
</template>

<style scoped>
.preferences { padding-inline: var(--page-gutter); }
.preference {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-3);
  min-height: var(--row-min-height);
  padding: var(--row-padding-block) var(--card-padding);
}
.preference + .preference::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  left: var(--card-padding);
  border-top: 1px solid var(--separator);
}
/* The value is the row's pop-up: secondary text with its chevron at the trailing end; with large text it moves under
   the label instead of truncating. */
.value { max-width: 100%; min-height: var(--tap-target); margin-inline-start: auto; border: 0; border-radius: var(--radius-control); background-color: transparent; color: var(--label-2); text-align: end; cursor: pointer; }
.value:disabled { opacity: 0.6; }
</style>
