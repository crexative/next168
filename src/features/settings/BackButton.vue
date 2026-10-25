<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft } from 'lucide-vue-next'
import { registerIcons } from '@/ui/icons'
import Icon from '@/ui/Icon.vue'
import { backTarget, type TrailView } from './navigationTrail'

registerIcons({ 'chevron-left': ChevronLeft })

// `current` is the screen this control sits on; `fallback` is where it leads when nothing else is known.
// `href` and `place` pin the destination (a sub-page returning to its parent) instead of following the trail.
const props = defineProps<{ current: TrailView; fallback: TrailView; href?: string; place?: string; iconOnly?: boolean }>()
const { t } = useI18n()

const PLACE_TITLES: Record<TrailView, string> = {
  today: 'app.tabs.today',
  week: 'app.tabs.week',
  tasks: 'app.tabs.tasks',
  insights: 'app.tabs.insights',
  settings: 'app.tabs.settings',
  checkin: 'checkin.title',
  assistant: 'assistant.title',
  proposals: 'proposals.title',
}

const target = computed(() => backTarget(props.current, props.fallback))
const destination = computed(() => props.href ?? `#/${target.value}`)
const place = computed(() => props.place ?? t(PLACE_TITLES[target.value]))
</script>

<template>
  <a class="back-button t-body" :class="{ 'is-icon-only': iconOnly }" :href="destination" :aria-label="t('setup.backTo', { place })" data-testid="back-button">
    <Icon name="chevron-left" :size="22" />
    <span>{{ place }}</span>
  </a>
</template>

<style scoped>
.back-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--tap-target);
  padding-inline-end: var(--space-3);
  color: var(--tint-label);
  text-decoration: none;
  transition: opacity 0.1s;
  touch-action: manipulation;
}
.back-button.is-icon-only { min-width: var(--tap-target); padding-inline-end: 0; }
.back-button.is-icon-only span { position: absolute; visibility: hidden; width: max-content; }
.back-button:active { opacity: 0.6; }
</style>
