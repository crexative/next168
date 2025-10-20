<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWeekStore } from '@/stores/weekStore'
import { DAYS_OF_WEEK } from '@/types'
import type { TimeBlock } from '@/types'
import { formatDuration } from '@/utils/timeCalculator'
import dayjs from 'dayjs'
import BaseModal from '@/components/BaseModal.vue'
import BaseBottomSheet from '@/components/BaseBottomSheet.vue'
import TimePicker from '@/components/ui/TimePicker.vue'

const { t } = useI18n()
const store = useWeekStore()

// Current date
const currentDate = computed(() => {
  return dayjs().format('MMMM D, YYYY')
})

// Current day of week (0 = Sunday)
const currentDayOfWeek = computed(() => {
  return dayjs().day()
})

// Mobile day selector
const selectedDay = ref(currentDayOfWeek.value)

// Tablet center day selector
const tabletCenterDay = ref(currentDayOfWeek.value)

// Modal state
const showModal = ref(false)
const editingBlock = ref<TimeBlock | null>(null)
const formData = ref({
  title: '',
  description: '',
  categoryId: '',
  dayOfWeek: 0,
  startTime: '09:00',
  endTime: '10:00'
})
const errorMessage = ref('')

function openAddModal(dayOfWeek: number) {
  editingBlock.value = null
  formData.value = {
    title: '',
    description: '',
    categoryId: store.categories[0]?.id || '',
    dayOfWeek,
    startTime: '09:00',
    endTime: '10:00'
  }
  errorMessage.value = ''
  showModal.value = true
}

function openEditModal(block: TimeBlock) {
  editingBlock.value = block
  formData.value = {
    title: block.title,
    description: block.description || '',
    categoryId: block.categoryId,
    dayOfWeek: block.dayOfWeek,
    startTime: block.startTime,
    endTime: block.endTime
  }
  errorMessage.value = ''
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  editingBlock.value = null
  errorMessage.value = ''
}

function saveTimeBlock() {
  errorMessage.value = ''

  const blockData = {
    title: formData.value.title.trim(),
    description: formData.value.description.trim(),
    categoryId: formData.value.categoryId,
    dayOfWeek: formData.value.dayOfWeek,
    startTime: formData.value.startTime,
    endTime: formData.value.endTime
  }

  let result
  if (editingBlock.value) {
    result = store.updateTimeBlock(editingBlock.value.id, blockData)
  } else {
    result = store.addTimeBlock(blockData)
  }

  if (result.success) {
    closeModal()
  } else {
    errorMessage.value = result.error || 'An error occurred'
  }
}

function deleteTimeBlock() {
  if (editingBlock.value && confirm(t('calendar.deleteConfirm', { title: editingBlock.value.title }))) {
    store.deleteTimeBlock(editingBlock.value.id)
    closeModal()
  }
}

function getCategoryColor(categoryId: string): string {
  const category = store.getCategoryById(categoryId)
  return category?.color || '#6b7280'
}

function getCategoryName(categoryId: string): string {
  const category = store.getCategoryById(categoryId)
  return category?.name || 'Unknown'
}

function getBlocksForDay(dayOfWeek: number) {
  return store.getTimeBlocksForDay(dayOfWeek)
}

const isMobile = computed(() => {
  return window.innerWidth <= 768
})

const modalTitle = computed(() => {
  return editingBlock.value ? t('calendar.editBlock') : t('calendar.addBlock')
})

// Translated day names
const translatedDays = computed(() => {
  return DAYS_OF_WEEK.map((day) => t(`calendar.days.${day.toLowerCase()}`))
})

// Calculate which 3 days to show on tablet (center day in middle)
const visibleDaysForTablet = computed(() => {
  const centerDay = tabletCenterDay.value
  const days = []

  // Previous day
  const prevDay = centerDay === 0 ? 6 : centerDay - 1
  days.push(prevDay)

  // Center day (middle)
  days.push(centerDay)

  // Next day
  const nextDay = centerDay === 6 ? 0 : centerDay + 1
  days.push(nextDay)

  return days
})

// Navigate tablet view
function navigateTabletPrev() {
  tabletCenterDay.value = (tabletCenterDay.value === 0 ? 6 : tabletCenterDay.value - 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6
}

function navigateTabletNext() {
  tabletCenterDay.value = (tabletCenterDay.value === 6 ? 0 : tabletCenterDay.value + 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6
}
</script>

<template>
  <div class="weekly-calendar">
    <div class="header">
      <div class="header-content">
        <h2>{{ t('calendar.title') }}</h2>
        <p class="current-date">{{ currentDate }}</p>
      </div>
    </div>

    <!-- Desktop: 7-column grid -->
    <div class="calendar-grid desktop-only">
      <div
        v-for="(day, dayIndex) in DAYS_OF_WEEK"
        :key="dayIndex"
        class="day-column"
        :class="{ 'today-column': dayIndex === currentDayOfWeek }"
      >
        <div class="day-header">
          <div class="day-header-content">
            <h3>{{ translatedDays[dayIndex] }}</h3>
            <button class="btn-add-small" @click="openAddModal(dayIndex)" :title="t('calendar.addBlock')">
              +
            </button>
          </div>
        </div>
        <div class="time-blocks">
          <div
            v-for="block in getBlocksForDay(dayIndex)"
            :key="block.id"
            class="time-block"
            :style="{ borderLeftColor: getCategoryColor(block.categoryId) }"
            @click="openEditModal(block)"
          >
            <div class="block-time">{{ block.startTime }} - {{ block.endTime }}</div>
            <div class="block-title">{{ block.title }}</div>
            <div class="block-category">{{ getCategoryName(block.categoryId) }}</div>
            <div class="block-duration">{{ formatDuration(block.durationMinutes) }}</div>
          </div>
          <div v-if="getBlocksForDay(dayIndex).length === 0" class="empty-day">
            {{ t('calendar.noBlocks') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Tablet: 3-column grid (current day in middle) -->
    <div class="tablet-only">
      <div class="tablet-nav-header">
        <button
          class="btn-nav"
          @click="navigateTabletPrev"
          aria-label="Previous day"
        >
          ‹
        </button>
        <div class="tablet-day-title">
          <h3>{{ translatedDays[tabletCenterDay] }}</h3>
          <div class="btn-today-container">
            <button
              v-if="tabletCenterDay !== currentDayOfWeek"
              class="btn-today"
              @click="tabletCenterDay = currentDayOfWeek"
              aria-label="Go to today"
            >
              {{ t('common.today') }}
            </button>
          </div>
        </div>
        <button
          class="btn-nav"
          @click="navigateTabletNext"
          aria-label="Next day"
        >
          ›
        </button>
      </div>

      <div class="calendar-grid">
        <div
          v-for="dayIndex in visibleDaysForTablet"
          :key="dayIndex"
          class="day-column"
          :class="{ 'today-column': dayIndex === currentDayOfWeek }"
        >
          <div class="day-header">
            <div class="day-header-content">
              <h3>{{ translatedDays[dayIndex] }}</h3>
              <button class="btn-add-small" @click="openAddModal(dayIndex)" :title="t('calendar.addBlock')">
                +
              </button>
            </div>
          </div>
          <div class="time-blocks">
            <div
              v-for="block in getBlocksForDay(dayIndex)"
              :key="block.id"
              class="time-block"
              :style="{ borderLeftColor: getCategoryColor(block.categoryId) }"
              @click="openEditModal(block)"
            >
              <div class="block-time">{{ block.startTime }} - {{ block.endTime }}</div>
              <div class="block-title">{{ block.title }}</div>
              <div class="block-category">{{ getCategoryName(block.categoryId) }}</div>
              <div class="block-duration">{{ formatDuration(block.durationMinutes) }}</div>
            </div>
            <div v-if="getBlocksForDay(dayIndex).length === 0" class="empty-day">
              {{ t('calendar.noBlocks') }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Mobile: Single day view -->
    <div class="mobile-only">
      <div class="tablet-nav-header">
        <button
          class="btn-nav"
          @click="selectedDay = (selectedDay === 0 ? 6 : selectedDay - 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6"
          aria-label="Previous day"
        >
          ‹
        </button>
        <div class="tablet-day-title">
          <h3>{{ translatedDays[selectedDay] }}</h3>
          <div class="btn-today-container">
            <button
              v-if="selectedDay !== currentDayOfWeek"
              class="btn-today"
              @click="selectedDay = currentDayOfWeek"
              aria-label="Go to today"
            >
              {{ t('common.today') }}
            </button>
          </div>
        </div>
        <button
          class="btn-nav"
          @click="selectedDay = (selectedDay === 6 ? 0 : selectedDay + 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6"
          aria-label="Next day"
        >
          ›
        </button>
      </div>

      <div class="calendar-grid mobile-single-column">
        <div class="day-column">
          <div class="time-blocks">
            <div
              v-for="block in getBlocksForDay(selectedDay)"
              :key="block.id"
              class="time-block"
              :style="{ borderLeftColor: getCategoryColor(block.categoryId) }"
              @click="openEditModal(block)"
            >
              <div class="block-time">{{ block.startTime }} - {{ block.endTime }}</div>
              <div class="block-title">{{ block.title }}</div>
              <div class="block-category">{{ getCategoryName(block.categoryId) }}</div>
              <div class="block-duration">{{ formatDuration(block.durationMinutes) }}</div>
            </div>
            <div v-if="getBlocksForDay(selectedDay).length === 0" class="empty-day">
              <p>{{ t('calendar.noBlocksDay') }}</p>
              <button class="btn btn-primary" @click="openAddModal(selectedDay)">
                {{ t('calendar.addFirstBlock') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Floating Action Button (Mobile) -->
      <button class="fab-mobile" @click="openAddModal(selectedDay)" :aria-label="t('calendar.addBlock')">
        +
      </button>
    </div>

    <!-- Modal (Desktop & Tablet) -->
    <BaseModal
      :show="showModal && !isMobile"
      :title="modalTitle"
      :show-footer="true"
      @close="closeModal"
    >
      <template #body>
        <div v-if="errorMessage" class="error-message">
          {{ errorMessage }}
        </div>

        <div class="form-group">
          <label for="block-title">{{ t('calendar.fields.title') }}</label>
          <input
            id="block-title"
            v-model="formData.title"
            type="text"
            :placeholder="t('calendar.fields.titlePlaceholder')"
            maxlength="100"
          />
        </div>

        <div class="form-group">
          <label for="block-description">{{ t('calendar.fields.description') }}</label>
          <textarea
            id="block-description"
            v-model="formData.description"
            rows="3"
            :placeholder="t('calendar.fields.descriptionPlaceholder')"
            maxlength="500"
          ></textarea>
        </div>

        <div class="form-group">
          <label for="block-category">{{ t('calendar.fields.category') }}</label>
          <select id="block-category" v-model="formData.categoryId">
            <option value="" disabled>{{ t('calendar.fields.categoryPlaceholder') }}</option>
            <option
              v-for="category in store.categories"
              :key="category.id"
              :value="category.id"
            >
              {{ category.icon }} {{ category.name }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label for="block-day">{{ t('calendar.fields.day') }}</label>
          <select id="block-day" v-model.number="formData.dayOfWeek">
            <option
              v-for="(day, index) in DAYS_OF_WEEK"
              :key="index"
              :value="index"
            >
              {{ translatedDays[index] }}
            </option>
          </select>
        </div>

        <div class="form-row">
          <TimePicker
            v-model="formData.startTime"
            :label="t('calendar.fields.startTime')"
            id="block-start"
          />
          <TimePicker
            v-model="formData.endTime"
            :label="t('calendar.fields.endTime')"
            id="block-end"
          />
        </div>
      </template>

      <template #footer>
        <div class="modal-footer-left">
          <button
            v-if="editingBlock"
            class="btn btn-danger"
            @click="deleteTimeBlock"
          >
            {{ t('common.delete') }}
          </button>
        </div>
        <div class="modal-footer-right">
          <button class="btn btn-secondary" @click="closeModal">
            {{ t('common.cancel') }}
          </button>
          <button class="btn btn-primary" @click="saveTimeBlock">
            {{ editingBlock ? t('common.update') : t('common.add') }}
          </button>
        </div>
      </template>
    </BaseModal>

    <!-- Bottom Sheet (Mobile) -->
    <BaseBottomSheet
      :show="showModal && isMobile"
      :title="modalTitle"
      :show-footer="true"
      @close="closeModal"
    >
      <template #body>
        <div v-if="errorMessage" class="error-message">
          {{ errorMessage }}
        </div>

        <div class="form-group">
          <label for="block-title-mobile">{{ t('calendar.fields.title') }}</label>
          <input
            id="block-title-mobile"
            v-model="formData.title"
            type="text"
            :placeholder="t('calendar.fields.titlePlaceholder')"
            maxlength="100"
          />
        </div>

        <div class="form-group">
          <label for="block-description-mobile">{{ t('calendar.fields.description') }}</label>
          <textarea
            id="block-description-mobile"
            v-model="formData.description"
            rows="3"
            :placeholder="t('calendar.fields.descriptionPlaceholder')"
            maxlength="500"
          ></textarea>
        </div>

        <div class="form-group">
          <label for="block-category-mobile">{{ t('calendar.fields.category') }}</label>
          <select id="block-category-mobile" v-model="formData.categoryId">
            <option value="" disabled>{{ t('calendar.fields.categoryPlaceholder') }}</option>
            <option
              v-for="category in store.categories"
              :key="category.id"
              :value="category.id"
            >
              {{ category.icon }} {{ category.name }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label for="block-day-mobile">{{ t('calendar.fields.day') }}</label>
          <select id="block-day-mobile" v-model.number="formData.dayOfWeek">
            <option
              v-for="(day, index) in DAYS_OF_WEEK"
              :key="index"
              :value="index"
            >
              {{ translatedDays[index] }}
            </option>
          </select>
        </div>

        <div class="form-row">
          <TimePicker
            v-model="formData.startTime"
            :label="t('calendar.fields.startTime')"
            id="block-start-mobile"
          />
          <TimePicker
            v-model="formData.endTime"
            :label="t('calendar.fields.endTime')"
            id="block-end-mobile"
          />
        </div>
      </template>

      <template #footer>
        <div class="modal-footer-left">
          <button
            v-if="editingBlock"
            class="btn btn-danger"
            @click="deleteTimeBlock"
          >
            {{ t('common.delete') }}
          </button>
        </div>
        <div class="modal-footer-right">
          <button class="btn btn-secondary" @click="closeModal">
            {{ t('common.cancel') }}
          </button>
          <button class="btn btn-primary" @click="saveTimeBlock">
            {{ editingBlock ? t('common.update') : t('common.add') }}
          </button>
        </div>
      </template>
    </BaseBottomSheet>
  </div>
</template>

<style scoped>
.weekly-calendar {
  padding: 0;
}

.header {
  padding: 1.5rem 2rem;
  border-bottom: 1px solid #e5e7eb;
  background: white;
}

.header-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.header h2 {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
  color: #1f2937;
  line-height: 1.2;
}

.current-date {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 400;
  color: #6b7280;
}

/* Desktop Grid */
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.5rem;
  width: 100%;
  padding: 2rem;
}

.day-column {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  overflow: hidden;
  transition: all 0.2s;
}

.day-column.today-column {
  border: 2px solid #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.day-column.today-column .day-header {
  background: #dbeafe;
}

.day-header {
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  padding: 0.75rem 0.5rem;
}

.day-header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-left: 0.25rem;
  margin-right: 0.25rem;
}

.day-header h3 {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1f2937;
}

.day-column.today-column .day-header h3 {
  color: #1e40af;
  font-weight: 700;
}

.btn-add-small {
  background: #3b82f6;
  color: white;
  border: none;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.25rem;
  font-size: 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
}

.btn-add-small:hover {
  background: #2563eb;
}

.time-blocks {
  padding: 0.5rem;
  min-height: 200px;
}

.time-block {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-left: 4px solid #3b82f6;
  border-radius: 0.375rem;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  margin-left: 0.25rem;
  margin-right: 0.25rem;
  cursor: pointer;
  transition: all 0.2s;
}

.time-block:hover {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

.block-time {
  font-size: 0.75rem;
  color: #6b7280;
  margin-bottom: 0.25rem;
  font-weight: 500;
}

.block-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.block-category {
  font-size: 0.75rem;
  color: #6b7280;
  margin-bottom: 0.25rem;
}

.block-duration {
  font-size: 0.75rem;
  color: #3b82f6;
  font-weight: 500;
}

.empty-day {
  text-align: center;
  padding: 2rem 0.5rem;
  color: #9ca3af;
  font-size: 0.875rem;
}

/* Mobile Styles */
.mobile-only {
  display: none;
}

.tablet-only {
  display: none;
}

.desktop-only {
  display: grid;
}

.tablet-nav-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background: white;
  border-bottom: 1px solid #e5e7eb;
}

.tablet-day-title {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.tablet-day-title h3 {
  margin: 0;
  font-size: 1.25rem;
  color: #1f2937;
  text-align: center;
}

.btn-today-container {
  min-height: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-today {
  background: transparent;
  border: 1px solid #3b82f6;
  color: #3b82f6;
  border-radius: 0.25rem;
  padding: 0.25rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-today:hover {
  background: #3b82f6;
  color: white;
}

.btn-nav {
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 0.375rem;
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-nav:hover {
  background: #e5e7eb;
  color: #1f2937;
}

.mobile-single-column {
  grid-template-columns: 1fr;
  padding: 1rem;
}

.mobile-single-column .day-column {
  border: none;
  border-radius: 0;
  background: transparent;
}

/* Floating Action Button (Mobile) */
.fab-mobile {
  position: fixed;
  bottom: calc(2rem + env(safe-area-inset-bottom));
  right: 1.5rem;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 50%;
  background: #3b82f6;
  color: white;
  border: none;
  font-size: 2rem;
  font-weight: 300;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  display: none;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  z-index: 100;
  line-height: 1;
}

.fab-mobile:hover {
  background: #2563eb;
  transform: scale(1.05);
  box-shadow: 0 6px 16px rgba(59, 130, 246, 0.5);
}

.fab-mobile:active {
  transform: scale(0.95);
}

/* Buttons */
.btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-primary:hover {
  background: #2563eb;
}

.btn-secondary {
  background: #e5e7eb;
  color: #1f2937;
}

.btn-secondary:hover {
  background: #d1d5db;
}

.btn-danger {
  background: #dc2626;
  color: white;
}

.btn-danger:hover {
  background: #b91c1c;
}

/* Modal Footer Layout (for slotted content) */
.modal-footer-left {
  display: flex;
  gap: 0.75rem;
}

.modal-footer-right {
  display: flex;
  gap: 0.75rem;
}

.error-message {
  background: #fee2e2;
  color: #dc2626;
  padding: 0.75rem;
  border-radius: 0.375rem;
  margin-bottom: 1rem;
  font-size: 0.875rem;
}

.form-group {
  margin-bottom: 1.25rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: #374151;
  font-size: 0.875rem;
}

.form-group input[type="text"],
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.875rem;
}

.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-group textarea {
  resize: vertical;
  font-family: inherit;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  align-items: start;
}

/* Responsive */
@media (min-width: 769px) and (max-width: 1024px) {
  .header {
    padding: 1.25rem 1.5rem;
  }

  .header h2 {
    font-size: 1.5rem;
  }

  .tablet-only .calendar-grid {
    padding: 1.5rem;
    grid-template-columns: repeat(3, 1fr);
  }

  .desktop-only {
    display: none;
  }

  .tablet-only {
    display: block;
  }
}

@media (max-width: 768px) {
  .header {
    padding: 1rem 1rem 0.75rem 1rem;
    background: white;
    border-bottom: none;
  }

  .header-content {
    text-align: center;
  }

  .header h2 {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .current-date {
    font-size: 0.75rem;
    color: #9ca3af;
  }

  .desktop-only {
    display: none;
  }

  .tablet-only {
    display: none;
  }

  .mobile-only {
    display: block;
  }

  .tablet-nav-header {
    padding: 0.875rem 1rem;
    background: white;
    border-bottom: 1px solid #e5e7eb;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .tablet-day-title h3 {
    font-size: 1.125rem;
    font-weight: 600;
  }

  .btn-today {
    font-size: 0.6875rem;
    padding: 0.25rem 0.625rem;
  }

  .mobile-single-column {
    padding: 0;
    gap: 0;
  }

  .mobile-single-column .day-column {
    padding: 1rem;
  }

  .time-blocks {
    padding: 0;
    min-height: auto;
  }

  .time-block {
    background: white;
    border: 1px solid #e5e7eb;
    border-left: 4px solid #3b82f6;
    border-radius: 0.75rem;
    padding: 1rem;
    margin-bottom: 0.75rem;
    margin-left: 0;
    margin-right: 0;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  .time-block:active {
    transform: scale(0.98);
  }

  .block-time {
    font-size: 0.8125rem;
    color: #3b82f6;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .block-title {
    font-size: 1rem;
    font-weight: 600;
    color: #1f2937;
    margin-bottom: 0.375rem;
  }

  .block-category {
    font-size: 0.8125rem;
    color: #6b7280;
    margin-bottom: 0.375rem;
  }

  .block-duration {
    font-size: 0.8125rem;
    color: #3b82f6;
    font-weight: 600;
  }

  .empty-day {
    padding: 4rem 1.5rem;
    text-align: center;
  }

  .empty-day p {
    margin-bottom: 1.25rem;
    font-size: 0.9375rem;
    color: #6b7280;
  }

  .fab-mobile {
    display: flex;
    bottom: calc(1.5rem + env(safe-area-inset-bottom));
  }
}
</style>
