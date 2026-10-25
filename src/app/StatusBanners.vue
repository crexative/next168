<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { usePlannerStore } from '@/stores/plannerStore'
import { reloadBlocked, reloadWhenReady, updateDismissed, updateNoticeShown } from './updates'

const { t } = useI18n()
const planner = usePlannerStore()

const errorMessage = computed(() => {
  const code = planner.error
  // A storage failure has its own blocking screen.
  if (!code || code === 'no-web-locks' || planner.status === 'error') return null
  return code === 'conflict' ? t('app.storage.conflict') : t('app.storage.saveFailed', { reason: code })
})

// The notices float over the page; their layout height is published (--banners-block-size) and --banners-height adds
// their gap above the tab bar in CSS, so both grow with the text and the page and Week's "+" keep clear of them.
// The layout size, not the drawn box: a transform on an ancestor would otherwise shrink it.
const root = ref<HTMLElement | null>(null)
let observer: ResizeObserver | undefined
onMounted(() => {
  if (!root.value || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(([entry]) => {
    const height = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height ?? 0
    window.document.documentElement.style.setProperty('--banners-block-size', `${height}px`)
  })
  observer.observe(root.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.document.documentElement.style.removeProperty('--banners-block-size')
})

const reload = () => reloadWhenReady(() => planner.settled())
</script>

<template>
  <div ref="root" class="banners">
    <div v-if="planner.status === 'readonly' && planner.error === 'no-web-locks'" class="banner" role="status">
      <Icon name="info" :size="20" />
      <p class="t-subhead">{{ t('app.storage.readonlyNoLocks') }}</p>
    </div>
    <div v-if="planner.status === 'unsupported'" class="banner" role="status">
      <Icon name="refresh-cw" :size="20" />
      <p class="t-subhead">{{ t('app.storage.unsupported') }}</p>
      <Button variant="tinted" @click="reload">{{ t('app.update.reload') }}</Button>
    </div>
    <div v-if="planner.legacyChanged" class="banner" role="status">
      <Icon name="triangle-alert" :size="20" />
      <p class="t-subhead">{{ t('app.storage.legacyChanged') }}</p>
      <Button variant="plain" @click="planner.legacyChanged = false">{{ t('common.dismiss') }}</Button>
    </div>
    <div v-if="errorMessage" class="banner is-error" role="alert">
      <Icon name="triangle-alert" :size="20" />
      <p class="t-subhead">{{ errorMessage }}</p>
      <Button variant="plain" @click="planner.dismissError()">{{ t('common.dismiss') }}</Button>
    </div>
    <div v-if="updateNoticeShown" class="banner" role="status" data-testid="update-banner">
      <Icon name="refresh-cw" :size="20" />
      <p class="t-subhead">{{ reloadBlocked ? t('app.update.blocked') : t('app.update.available') }}</p>
      <Button variant="tinted" @click="reload">{{ t('app.update.reload') }}</Button>
      <button type="button" class="banner-close" data-testid="update-banner-close" :aria-label="t('common.dismiss')" @click="updateDismissed = true">
        <Icon name="x" :size="20" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Bottom notice above the tab bar: fixed, so a late notice never pushes the page down, and clear of the large title and the Now card.
   Its gap above the bar is the --space-3 that --banners-height adds. */
.banners {
  position: fixed;
  inset: auto calc(var(--safe-right) + var(--space-4)) calc(var(--tabbar-inset) + var(--space-3)) calc(var(--safe-left) + var(--space-4));
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 40rem;
  margin-inline: auto;
  pointer-events: none;
}
.banners:empty { display: none; }
@media (min-width: 1024px) {
  .banners { inset-block-end: var(--space-6); inset-inline-start: calc(var(--sidebar-inset, var(--sidebar-width)) + var(--space-4)); }
}
.banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--surface);
  color: var(--label);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
  pointer-events: auto;
}
.banner p { flex: 1; }
.banner > .banner-close {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--tap-target);
  height: var(--tap-target);
  margin-inline-end: calc(var(--space-2) * -1);
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--label-2);
}
.banner.is-error { border: 1px solid var(--danger); }
.banner > :first-child { color: var(--label-2); }
.is-error > :first-child { color: var(--danger-label); }
</style>

<style>
/* --banners-height is how far the notices reach above the tab bar while one shows (0 otherwise). */
html:has(.banners > .banner) { --banners-height: calc(var(--banners-block-size, 0px) + var(--space-3)); }
</style>
