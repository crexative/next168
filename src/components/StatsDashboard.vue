<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale
} from 'chart.js'
import { useWeekStore } from '@/stores/weekStore'
import { DAYS_OF_WEEK, TOTAL_WEEK_HOURS } from '@/types'
import { minutesToHours } from '@/utils/timeCalculator'

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale)

const { t } = useI18n()
const store = useWeekStore()

const summaryCards = computed(() => [
  {
    title: t('statistics.scheduledHours'),
    value: store.totalScheduledHours.toFixed(1),
    unit: t('common.hours'),
    icon: '📅',
    color: '#3b82f6'
  },
  {
    title: t('statistics.availableHours'),
    value: store.unscheduledHours.toFixed(1),
    unit: t('common.hours'),
    icon: '⏰',
    color: '#10b981'
  },
  {
    title: t('statistics.totalBlocks'),
    value: store.timeBlocks.length,
    unit: 'blocks',
    icon: '📊',
    color: '#f59e0b'
  },
  {
    title: t('statistics.categoriesCount'),
    value: store.categories.length,
    unit: 'active',
    icon: '🏷️',
    color: '#8b5cf6'
  }
])

const categoryBreakdown = computed(() => {
  return store.categoryStats.map(stat => {
    const category = store.getCategoryById(stat.categoryId)
    return {
      ...stat,
      name: category?.name || 'Unknown',
      color: category?.color || '#6b7280',
      icon: category?.icon || '📁'
    }
  }).sort((a, b) => b.totalHours - a.totalHours)
})

const weekUtilization = computed(() => {
  const percentage = (store.totalScheduledHours / TOTAL_WEEK_HOURS) * 100
  return {
    scheduled: percentage,
    available: 100 - percentage
  }
})

const chartData = computed(() => {
  // Get all unique categories that have blocks
  const categoriesWithData = new Set<string>()

  DAYS_OF_WEEK.forEach((_, dayIndex) => {
    const blocks = store.getTimeBlocksForDay(dayIndex)
    blocks.forEach(block => categoriesWithData.add(block.categoryId))
  })

  // Create datasets for each category
  const datasets = store.categories
    .filter(cat => categoriesWithData.has(cat.id))
    .map(category => {
      const data = DAYS_OF_WEEK.map((_, dayIndex) => {
        const blocks = store.getTimeBlocksForDay(dayIndex)
        const categoryBlocks = blocks.filter(b => b.categoryId === category.id)
        const categoryMinutes = categoryBlocks.reduce((sum, block) => sum + block.durationMinutes, 0)
        return minutesToHours(categoryMinutes)
      })

      return {
        label: category.name,
        backgroundColor: category.color,
        data
      }
    })

  return {
    labels: DAYS_OF_WEEK.map(day => t(`calendar.days.${day.toLowerCase()}`).substring(0, 3)),
    datasets
  }
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      stacked: true,
      grid: {
        display: false
      }
    },
    y: {
      stacked: true,
      beginAtZero: true,
      title: {
        display: true,
        text: t('common.hours')
      },
      ticks: {
        callback: (value: number) => value + 'h'
      }
    }
  },
  plugins: {
    legend: {
      display: true,
      position: 'bottom' as const
    },
    tooltip: {
      callbacks: {
        label: (context: any) => {
          return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}h`
        }
      }
    }
  }
}))
</script>

<template>
  <div class="stats-dashboard">
    <div class="header">
      <h2>{{ t('statistics.title') }}</h2>
    </div>

    <!-- Summary Cards -->
    <div class="summary-cards">
      <div
        v-for="card in summaryCards"
        :key="card.title"
        class="summary-card"
        :style="{ borderTopColor: card.color }"
      >
        <div class="card-icon" :style="{ backgroundColor: card.color + '20' }">
          {{ card.icon }}
        </div>
        <div class="card-content">
          <div class="card-value">{{ card.value }}</div>
          <div class="card-unit">{{ card.unit }}</div>
          <div class="card-title">{{ card.title }}</div>
        </div>
      </div>
    </div>

    <!-- Two Column Layout for Category Breakdown and Daily Distribution -->
    <div class="two-column-grid">
      <!-- Category Breakdown -->
      <div class="section">
        <h3 class="section-title">{{ t('statistics.categoryBreakdown') }}</h3>
        <div class="category-breakdown">
          <div
            v-for="item in categoryBreakdown"
            :key="item.categoryId"
            class="category-item"
          >
            <div class="category-info">
              <span class="category-icon">{{ item.icon }}</span>
              <span class="category-name">{{ item.name }}</span>
            </div>
            <div class="category-stats-inline">
              <span class="stat-value">{{ item.totalHours.toFixed(1) }}h</span>
              <span class="stat-separator">/</span>
              <span class="stat-limit">{{ store.getCategoryById(item.categoryId)?.weeklyHourLimit }}h</span>
            </div>
            <div class="progress-bar-container">
              <div
                class="progress-bar"
                :style="{
                  width: `${Math.min(item.percentageOfLimit, 100)}%`,
                  backgroundColor: item.color
                }"
              ></div>
            </div>
            <div class="category-percentage">
              {{ Math.round(item.percentageOfLimit) }}% of limit
            </div>
          </div>
          <div v-if="categoryBreakdown.length === 0" class="empty-state">
            <p>{{ t('statistics.noCategories') }}</p>
          </div>
        </div>
      </div>

      <!-- Daily Distribution -->
      <div class="section">
        <h3 class="section-title">{{ t('statistics.dailyDistribution') }}</h3>
        <div class="daily-chart">
          <Bar :data="chartData" :options="chartOptions" />
        </div>
      </div>
    </div>

    <!-- Week Utilization -->
    <div class="section">
      <h3 class="section-title">{{ t('statistics.weekUtilization') }}</h3>
      <div class="utilization-chart">
        <div class="summary-text">
          <p>
            {{ t('statistics.utilizationText', {
              scheduled: store.totalScheduledHours.toFixed(1),
              total: TOTAL_WEEK_HOURS,
              percentage: Math.round(weekUtilization.scheduled)
            }) }}
          </p>
          <p v-if="store.unscheduledHours > 0">
            {{ t('statistics.availableText', {
              available: store.unscheduledHours.toFixed(1)
            }) }}
          </p>
        </div>
        <div class="utilization-bars">
          <div
            class="utilization-bar scheduled"
            :style="{ width: `${weekUtilization.scheduled}%` }"
            :title="`${t('statistics.scheduled')}: ${store.totalScheduledHours.toFixed(1)} ${t('common.hours')}`"
          >
            <span v-if="weekUtilization.scheduled > 10" class="bar-label">
              {{ store.totalScheduledHours.toFixed(1) }}h
            </span>
          </div>
          <div
            class="utilization-bar available"
            :style="{ width: `${weekUtilization.available}%` }"
            :title="`${t('statistics.available')}: ${store.unscheduledHours.toFixed(1)} ${t('common.hours')}`"
          >
            <span v-if="weekUtilization.available > 10" class="bar-label">
              {{ store.unscheduledHours.toFixed(1) }}h
            </span>
          </div>
        </div>
        <div class="utilization-legend">
          <div class="legend-item">
            <span class="legend-color scheduled"></span>
            <span class="legend-label">{{ t('statistics.scheduled') }} ({{ Math.round(weekUtilization.scheduled) }}%)</span>
          </div>
          <div class="legend-item">
            <span class="legend-color available"></span>
            <span class="legend-label">{{ t('statistics.available') }} ({{ Math.round(weekUtilization.available) }}%)</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats-dashboard {
  padding: 0;
}

.header {
  margin-bottom: 2rem;
  padding: 2rem 2rem 0 2rem;
}

.header h2 {
  margin: 0;
  font-size: 1.75rem;
  color: #1f2937;
}

/* Summary Cards */
.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
  padding: 0 2rem;
}

.summary-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-top: 4px solid #3b82f6;
  border-radius: 0.5rem;
  padding: 1.25rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  transition: box-shadow 0.2s;
}

.summary-card:hover {
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.card-icon {
  font-size: 2rem;
  width: 3rem;
  height: 3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  flex-shrink: 0;
}

.card-content {
  flex: 1;
}

.card-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: #1f2937;
  line-height: 1;
}

.card-unit {
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: 0.25rem;
}

.card-title {
  font-size: 0.875rem;
  color: #6b7280;
  margin-top: 0.25rem;
}

/* Two Column Grid Layout */
.two-column-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  padding: 0 2rem;
  margin-bottom: 1.5rem;
}

/* Sections */
.section {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
}

.section:not(.two-column-grid .section) {
  margin: 0 2rem 1.5rem 2rem;
}

.section-title {
  margin: 0 0 1.25rem 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  flex-shrink: 0;
}

/* Category Breakdown */
.category-breakdown {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.category-item {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto auto;
  gap: 0.5rem;
  align-items: center;
}

.category-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  grid-column: 1;
  grid-row: 1;
}

.category-icon {
  font-size: 1.25rem;
}

.category-name {
  font-weight: 500;
  color: #1f2937;
}

.category-stats-inline {
  grid-column: 2;
  grid-row: 1;
  font-size: 0.875rem;
  white-space: nowrap;
}

.stat-value {
  font-weight: 600;
  color: #1f2937;
}

.stat-separator {
  color: #9ca3af;
  margin: 0 0.25rem;
}

.stat-limit {
  color: #6b7280;
}

.progress-bar-container {
  grid-column: 1 / -1;
  grid-row: 2;
  width: 100%;
  height: 0.5rem;
  background: #e5e7eb;
  border-radius: 0.25rem;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  transition: width 0.3s ease;
}

.category-percentage {
  grid-column: 1 / -1;
  grid-row: 3;
  font-size: 0.75rem;
  color: #6b7280;
}

/* Week Utilization */
.utilization-chart {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.utilization-chart .summary-text {
  margin-bottom: 0;
}

.utilization-bars {
  display: flex;
  height: 3rem;
  border-radius: 0.5rem;
  overflow: hidden;
  border: 1px solid #e5e7eb;
}

.utilization-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: width 0.3s ease;
  position: relative;
}

.utilization-bar.scheduled {
  background: #3b82f6;
}

.utilization-bar.available {
  background: #e5e7eb;
}

.bar-label {
  color: white;
  font-weight: 600;
  font-size: 0.875rem;
}

.utilization-bar.available .bar-label {
  color: #6b7280;
}

.utilization-legend {
  display: flex;
  gap: 1.5rem;
  justify-content: center;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.legend-color {
  width: 1rem;
  height: 1rem;
  border-radius: 0.25rem;
}

.legend-color.scheduled {
  background: #3b82f6;
}

.legend-color.available {
  background: #e5e7eb;
}

.legend-label {
  color: #6b7280;
}

/* Daily Distribution */
.daily-chart {
  flex: 1;
  min-height: 300px;
  position: relative;
}

/* Summary Text */
.summary-text {
  line-height: 1.6;
  color: #4b5563;
}

.summary-text p {
  margin: 0 0 0.75rem 0;
}

.summary-text strong {
  color: #1f2937;
  font-weight: 600;
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: #9ca3af;
  font-size: 0.875rem;
}

/* Responsive */
@media (min-width: 1025px) {
  .summary-cards {
    grid-template-columns: repeat(4, 1fr);
  }
}

@media (max-width: 1024px) and (min-width: 769px) {
  .header {
    padding: 1.5rem 1.5rem 0 1.5rem;
  }

  .summary-cards {
    grid-template-columns: repeat(2, 1fr);
    padding: 0 1.5rem;
  }

  .two-column-grid {
    grid-template-columns: 1fr;
    padding: 0 1.5rem;
  }

  .section {
    padding: 1.25rem;
  }

  .section:not(.two-column-grid .section) {
    margin: 0 1.5rem 1.5rem 1.5rem;
  }
}

@media (max-width: 768px) {
  .header {
    padding: 1rem 1rem 0.75rem 1rem;
    background: white;
    border-bottom: none;
    text-align: center;
  }

  .header h2 {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .summary-cards {
    grid-template-columns: 1fr;
    padding: 1rem;
    gap: 0.875rem;
  }

  .summary-card {
    padding: 1.125rem 1rem;
    border-radius: 0.75rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  .summary-card:active {
    transform: scale(0.98);
  }

  .card-icon {
    font-size: 1.75rem;
    width: 2.75rem;
    height: 2.75rem;
  }

  .card-value {
    font-size: 1.625rem;
  }

  .two-column-grid {
    grid-template-columns: 1fr;
    padding: 0 1rem;
    gap: 1rem;
  }

  .section {
    padding: 1.125rem;
    border-radius: 0.75rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  .section:not(.two-column-grid .section) {
    margin: 0 1rem 1rem 1rem;
  }

  .section-title {
    font-size: 1.0625rem;
    margin-bottom: 1rem;
  }

  .category-breakdown {
    gap: 0.875rem;
  }

  .utilization-legend {
    flex-direction: column;
    align-items: flex-start;
  }

  .daily-chart {
    min-height: 200px;
  }
}

@media (max-width: 480px) {
  .summary-cards {
    gap: 0.75rem;
  }

  .category-item {
    grid-template-columns: 1fr;
  }

  .category-stats-inline {
    grid-column: 1;
    grid-row: 2;
  }

  .progress-bar-container {
    grid-row: 3;
  }

  .category-percentage {
    grid-row: 4;
  }
}
</style>
