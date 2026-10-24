<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { usePlannerStore } from '@/stores/plannerStore'
import { reloadBlocked, reloadWhenReady, updateAvailable } from './updates'

const { t } = useI18n()
const planner = usePlannerStore()

const errorMessage = computed(() => {
  const code = planner.error
  if (!code || code === 'no-web-locks') return null
  return code === 'conflict' ? t('app.storage.conflict') : t('app.storage.saveFailed', { reason: code })
})

const reload = () => reloadWhenReady(() => planner.settled())
</script>

<template>
  <div class="banners">
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
    <div v-if="updateAvailable" class="banner" role="status" data-testid="update-banner">
      <Icon name="refresh-cw" :size="20" />
      <p class="t-subhead">{{ reloadBlocked ? t('app.update.blocked') : t('app.update.available') }}</p>
      <Button variant="tinted" @click="reload">{{ t('app.update.reload') }}</Button>
    </div>
  </div>
</template>

<style scoped>
/* Overlay, not flow: a notice that arrives late (update, storage) must never push the page content down. */
.banners {
  position: fixed;
  inset: calc(var(--safe-top) + var(--toolbar-height)) calc(var(--safe-right) + var(--space-4)) auto calc(var(--safe-left) + var(--space-4));
  z-index: 15;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 1200px;
  margin-inline: auto;
  pointer-events: none;
}
.banners:empty { display: none; }
@media (min-width: 1024px) {
  .banners { inset-inline-start: calc(var(--sidebar-width) + var(--space-4)); }
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
.banner.is-error { border: 1px solid var(--danger); }
.banner > :first-child { color: var(--label-2); }
.is-error > :first-child { color: var(--danger-label); }
</style>
