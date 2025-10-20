<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'complete'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { t } = useI18n()
const currentStep = ref(0)

const steps = computed(() => [
  {
    title: t('tutorial.step1.title'),
    description: t('tutorial.step1.description'),
    icon: '📅',
    features: [
      t('tutorial.step1.feature1'),
      t('tutorial.step1.feature2'),
      t('tutorial.step1.feature3')
    ]
  },
  {
    title: t('tutorial.step2.title'),
    description: t('tutorial.step2.description'),
    icon: '🏷️',
    features: [
      t('tutorial.step2.feature1'),
      t('tutorial.step2.feature2'),
      t('tutorial.step2.feature3')
    ]
  },
  {
    title: t('tutorial.step3.title'),
    description: t('tutorial.step3.description'),
    icon: '⏰',
    features: [
      t('tutorial.step3.feature1'),
      t('tutorial.step3.feature2'),
      t('tutorial.step3.feature3')
    ]
  },
  {
    title: t('tutorial.step4.title'),
    description: t('tutorial.step4.description'),
    icon: '📊',
    features: [
      t('tutorial.step4.feature1'),
      t('tutorial.step4.feature2'),
      t('tutorial.step4.feature3')
    ]
  }
])

const isLastStep = computed(() => currentStep.value === steps.value.length - 1)

function nextStep() {
  if (isLastStep.value) {
    complete()
  } else {
    currentStep.value++
  }
}

function prevStep() {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}

function complete() {
  emit('complete')
  emit('update:modelValue', false)
}

function skip() {
  emit('update:modelValue', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="modelValue" class="tutorial-overlay">
        <Transition name="modal-scale">
          <div v-if="modelValue" class="tutorial-modal" @click.stop>
            <!-- Header -->
            <div class="tutorial-header">
              <div class="logo-section">
                <h1 class="app-logo">Next168</h1>
                <p class="app-tagline">{{ t('app.tagline') }}</p>
              </div>
              <button class="btn-close" @click="skip" aria-label="Close">×</button>
            </div>

            <!-- Progress Indicators -->
            <div class="progress-dots">
              <button
                v-for="(step, index) in steps"
                :key="index"
                class="dot"
                :class="{ active: index === currentStep }"
                @click="currentStep = index"
                :aria-label="`Go to step ${index + 1}`"
              ></button>
            </div>

            <!-- Content -->
            <div class="tutorial-content">
              <Transition name="slide-fade" mode="out-in">
                <div v-if="steps[currentStep]" :key="currentStep" class="step-content">
                  <div class="icon-large">{{ steps[currentStep]?.icon }}</div>
                  <h2 class="step-title">{{ steps[currentStep]?.title }}</h2>
                  <p class="step-description">{{ steps[currentStep]?.description }}</p>

                  <ul class="feature-list">
                    <li v-for="(feature, index) in steps[currentStep]?.features" :key="index">
                      <span class="check-icon">✓</span>
                      {{ feature }}
                    </li>
                  </ul>
                </div>
              </Transition>
            </div>

            <!-- Footer -->
            <div class="tutorial-footer">
              <button
                v-if="currentStep > 0"
                class="btn btn-secondary"
                @click="prevStep"
              >
                {{ t('tutorial.previous') }}
              </button>
              <div v-else></div>

              <div class="footer-right">
                <button
                  v-if="!isLastStep"
                  class="btn btn-ghost"
                  @click="skip"
                >
                  {{ t('tutorial.skip') }}
                </button>
                <button
                  class="btn btn-primary"
                  @click="nextStep"
                >
                  {{ isLastStep ? t('tutorial.getStarted') : t('tutorial.next') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Overlay */
.tutorial-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10000;
  padding: 1rem;
}

/* Modal */
.tutorial-modal {
  background: white;
  border-radius: 1.5rem;
  width: 90%;
  max-width: 600px;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 90vh;
}

/* Header */
.tutorial-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 2rem 2rem 1.5rem;
  background: linear-gradient(135deg, #1C2E4A 0%, #2a4365 100%);
  color: white;
}

.logo-section {
  flex: 1;
}

.app-logo {
  font-size: 2rem;
  font-weight: 700;
  margin: 0 0 0.25rem 0;
  background: linear-gradient(135deg, #30E6A5 0%, #ffffff 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.app-tagline {
  margin: 0;
  font-size: 0.9375rem;
  opacity: 0.9;
}

.btn-close {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  font-size: 1.75rem;
  color: white;
  cursor: pointer;
  padding: 0;
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  transition: all 0.2s;
  line-height: 1;
}

.btn-close:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* Progress Dots */
.progress-dots {
  display: flex;
  justify-content: center;
  gap: 0.75rem;
  padding: 1.5rem 2rem 1rem;
  background: white;
}

.dot {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  background: #d1d5db;
  border: none;
  cursor: pointer;
  transition: all 0.3s;
  padding: 0;
}

.dot.active {
  background: linear-gradient(135deg, #0D9B6E 0%, #30E6A5 100%);
  width: 2rem;
  border-radius: 0.375rem;
}

.dot:hover:not(.active) {
  background: #9ca3af;
}

/* Content */
.tutorial-content {
  padding: 2rem;
  flex: 1;
  overflow-y: auto;
}

.step-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.icon-large {
  font-size: 5rem;
  margin-bottom: 1.5rem;
  line-height: 1;
}

.step-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 1rem 0;
}

.step-description {
  font-size: 1.125rem;
  color: #6b7280;
  margin: 0 0 2rem 0;
  line-height: 1.6;
  max-width: 500px;
}

.feature-list {
  list-style: none;
  padding: 0;
  margin: 0;
  width: 100%;
  max-width: 400px;
}

.feature-list li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  margin-bottom: 0.5rem;
  background: #f9fafb;
  border-radius: 0.5rem;
  text-align: left;
  font-size: 0.9375rem;
  color: #374151;
}

.check-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  background: linear-gradient(135deg, #0D9B6E 0%, #30E6A5 100%);
  color: white;
  border-radius: 50%;
  font-size: 0.875rem;
  font-weight: 700;
  flex-shrink: 0;
}

/* Footer */
.tutorial-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem 2rem;
  border-top: 1px solid #e5e7eb;
  background: #f9fafb;
}

.footer-right {
  display: flex;
  gap: 0.75rem;
}

/* Buttons */
.btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 100px;
}

.btn-primary {
  background: linear-gradient(135deg, #0D9B6E 0%, #30E6A5 100%);
  color: white;
  box-shadow: 0 2px 8px rgba(13, 155, 110, 0.25);
}

.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(13, 155, 110, 0.35);
}

.btn-secondary {
  background: #e5e7eb;
  color: #374151;
}

.btn-secondary:hover {
  background: #d1d5db;
}

.btn-ghost {
  background: transparent;
  color: #6b7280;
}

.btn-ghost:hover {
  background: #f3f4f6;
  color: #374151;
}

/* Transitions */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-scale-enter-active {
  transition: all 0.3s ease;
}

.modal-scale-leave-active {
  transition: all 0.2s ease;
}

.modal-scale-enter-from {
  opacity: 0;
  transform: scale(0.9);
}

.modal-scale-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.3s ease;
}

.slide-fade-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.slide-fade-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

/* Responsive */
@media (max-width: 640px) {
  .tutorial-overlay {
    padding: 0;
  }

  .tutorial-modal {
    width: 100%;
    max-width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }

  .tutorial-header {
    padding: 1.5rem 1rem 1rem;
  }

  .app-logo {
    font-size: 1.5rem;
  }

  .app-tagline {
    font-size: 0.875rem;
  }

  .progress-dots {
    padding: 1rem 1.5rem 0.75rem;
  }

  .tutorial-content {
    padding: 1.5rem 1rem;
  }

  .icon-large {
    font-size: 4rem;
    margin-bottom: 1rem;
  }

  .step-title {
    font-size: 1.5rem;
  }

  .step-description {
    font-size: 1rem;
    margin-bottom: 1.5rem;
  }

  .tutorial-footer {
    padding: 1rem 1rem;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .footer-right {
    width: 100%;
    justify-content: space-between;
  }

  .btn {
    padding: 0.625rem 1.25rem;
    min-width: auto;
    flex: 1;
  }

  .btn-secondary {
    width: 100%;
  }
}
</style>
