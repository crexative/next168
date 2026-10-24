<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ListGroup from '@/ui/ListGroup.vue'
import ListRow from '@/ui/ListRow.vue'

const { t } = useI18n()
const persisted = ref<boolean | null>(null)

async function refreshPersistence(): Promise<void> {
  try {
    persisted.value = (await navigator.storage?.persisted?.()) ?? null
  } catch {
    persisted.value = null
  }
}

onMounted(refreshPersistence)
</script>

<template>
  <ListGroup :header="t('data.persistence.title')" :footer="t('data.persistence.footer')">
    <ListRow :title="t('data.persistence.status')">
      <template #trailing><span data-testid="persistence-status">{{ persisted === null ? t('data.persistence.unknown') : persisted ? t('data.persistence.granted') : t('data.persistence.notGranted') }}</span></template>
    </ListRow>
  </ListGroup>
</template>
