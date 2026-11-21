<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AddPlacement, ViewId } from '@/app/contracts'
import EventSheet from '@/features/calendars/EventSheet.vue'
import { openAdd } from '@/features/onboarding/reopen'
import TaskSheet from '@/features/tasks/TaskSheet.vue'
import { usePlannerStore } from '@/stores/plannerStore'
import AddMenu from './AddMenu.vue'
import type { AddKind } from './addKind'

// The shell's "+": the same sheets wherever it is pressed. A routine opens the guided setup in add mode, as before.
const props = defineProps<{ view: ViewId; placement: AddPlacement }>()

const planner = usePlannerStore()
const taskOpen = ref(false)
const eventOpen = ref(false)
// Only while the planner can be written: over an error screen or in a read-only tab there is nothing to add to.
const available = computed(() => planner.writable && !!planner.document)

function choose(kind: AddKind): void {
  if (!planner.writable) return
  if (kind === 'task') taskOpen.value = true
  else if (kind === 'event') eventOpen.value = true
  else openAdd('routine')
}
</script>

<template>
  <template v-if="available">
    <AddMenu :placement="props.placement" :direct="props.view === 'tasks' ? 'task' : undefined" @choose="choose" />
    <EventSheet v-model:open="eventOpen" />
    <TaskSheet v-model:open="taskOpen" />
  </template>
</template>
