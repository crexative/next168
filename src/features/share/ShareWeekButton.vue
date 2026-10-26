<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import ShareWeekSheet from './ShareWeekSheet.vue'

const { t } = useI18n()
const open = ref(false)
</script>

<template>
  <div class="share-entry">
    <Button variant="tinted" data-testid="share-week" @click="open = true">
      <Icon name="share" :size="20" />{{ t('share.entry') }}
    </Button>
    <ShareWeekSheet v-model:open="open" />
  </div>
</template>

<style scoped>
.share-entry { display: flex; }
</style>
