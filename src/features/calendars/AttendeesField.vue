<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/ui/Icon.vue'
import { addAttendees, attendeeList } from './eventDraft'

// The event's guests, kept in the draft as the same comma-separated text buildEvent reads.
const model = defineModel<string>({ required: true })
const { t } = useI18n()
const inputId = useId(), hintId = useId(), errorId = useId()
const typed = ref(''), error = ref(''), input = ref<HTMLInputElement>()
const guests = computed(() => attendeeList(model.value))

// Adds what was typed; false (with the reason shown) when part of it is not an email address.
function commit(): boolean {
  if (!typed.value.trim()) { typed.value = ''; error.value = ''; return true }
  const result = addAttendees(guests.value, typed.value)
  model.value = result.attendees.join(', ')
  typed.value = result.rejected.join(' ')
  error.value = result.rejected.length ? 'calendars.guestInvalid' : result.full ? 'calendars.guestLimit' : ''
  return result.rejected.length === 0
}
function onKeydown(event: KeyboardEvent): void {
  // Enter, a comma or a semicolon adds the address; Enter on an empty field still submits the form.
  if (event.key === ',' || event.key === ';' || (event.key === 'Enter' && typed.value.trim())) {
    event.preventDefault()
    commit()
  }
}
async function remove(email: string): Promise<void> {
  model.value = guests.value.filter(item => item !== email).join(', ')
  error.value = ''
  await nextTick()
  input.value?.focus()
}
defineExpose({ commit })
</script>
<template>
  <div class="guests">
    <label :for="inputId">{{ t('calendars.guests') }}</label>
    <ul v-if="guests.length" class="guest-chips" data-testid="event-guests">
      <li v-for="email in guests" :key="email" class="guest-chip">
        <span class="guest-email">{{ email }}</span>
        <button type="button" class="guest-remove" :aria-label="t('calendars.removeGuest', { email })" @click="remove(email)"><Icon name="x" :size="16" /></button>
      </li>
    </ul>
    <div class="guest-add">
      <input
        :id="inputId" ref="input" v-model="typed" type="text" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"
        :placeholder="t('calendars.guestPlaceholder')" :aria-invalid="error === 'calendars.guestInvalid' || undefined"
        :aria-describedby="error ? `${errorId} ${hintId}` : hintId" data-testid="event-guest-input" @keydown="onKeydown" @blur="commit"
      >
      <button type="button" class="guest-add-button t-subhead" data-testid="event-guest-add" @click="commit">{{ t('calendars.addGuest') }}</button>
    </div>
    <p v-if="error" :id="errorId" role="status" class="calendar-error">{{ t(error) }}</p>
    <p :id="hintId" class="t-footnote t-secondary">{{ t('calendars.guestsHint') }}</p>
  </div>
</template>
<style scoped src="./calendars.css"></style>
<style scoped>
.guests { display: grid; gap: var(--space-2); min-width: 0; }
.guests p { margin: 0; }
.guest-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.guest-chip { display: inline-flex; align-items: center; min-height: var(--tap-target); max-width: 100%; padding-inline-start: var(--space-3); border-radius: 999px; background: var(--surface-2); color: var(--label); font-size: .9375rem; }
.guest-email { min-width: 0; overflow-wrap: anywhere; }
.guest-remove { display: inline-grid; place-items: center; flex: none; width: var(--tap-target); height: var(--tap-target); padding: 0; border: 0; border-radius: 999px; background: transparent; color: var(--label-2); }
/* The field keeps room for its placeholder: on a narrow screen with large text, Add moves under it. */
.guest-add { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.guest-add input { flex: 1 1 13em; }
.guest-add-button { min-height: var(--tap-target); min-width: var(--tap-target); padding: 0 var(--space-2); border: 0; background: transparent; color: var(--tint-label); font-weight: 600; }
</style>
