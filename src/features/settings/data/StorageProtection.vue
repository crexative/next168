<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/ui/Button.vue'
import ListGroup from '@/ui/ListGroup.vue'
import ListRow from '@/ui/ListRow.vue'
import { requestPersistentStorage } from './storageProtection'

const { t } = useI18n()
const persisted = ref<boolean | null>(null)

async function refreshPersistence(): Promise<void> {
  try {
    persisted.value = (await navigator.storage?.persisted?.()) ?? null
  } catch {
    persisted.value = null
  }
}

async function request(): Promise<void> {
  await requestPersistentStorage()
  await refreshPersistence()
}

onMounted(refreshPersistence)
</script>

<template>
  <ListGroup :header="t('data.persistence.title')" :footer="t('data.persistence.footer')">
    <ListRow :title="t('data.persistence.status')">
      <template #trailing><span data-testid="persistence-status">{{ persisted === null ? t('data.persistence.unknown') : persisted ? t('data.persistence.granted') : t('data.persistence.notGranted') }}</span></template>
    </ListRow>
    <li v-if="persisted === false" class="note">
      <Button variant="plain" @click="request">{{ t('data.persistence.request') }}</Button>
    </li>
  </ListGroup>
</template>

<style scoped>
.note { padding: var(--space-1) var(--space-2); }
</style>
