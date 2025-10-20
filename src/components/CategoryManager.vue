<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWeekStore } from '@/stores/weekStore'
import type { Category } from '@/types'
import BaseModal from '@/components/BaseModal.vue'
import BaseBottomSheet from '@/components/BaseBottomSheet.vue'
import ConfirmDialog from './ui/ConfirmDialog.vue'

const { t } = useI18n()
const store = useWeekStore()

// Modal state
const showModal = ref(false)
const showDeleteDialog = ref(false)
const editingCategory = ref<Category | null>(null)
const categoryToDelete = ref<Category | null>(null)
const formData = ref({
  name: '',
  color: '#3b82f6',
  weeklyHourLimit: 10,
  icon: '💼'
})
const errorMessage = ref('')

// Emoji icons organized by category (5 rows, horizontal scroll)
// Each column represents a category with up to 5 related emojis
const commonIcons = [
  // Work & Business
  '💼', '👨‍💼', '👩‍💻', '💻', '📊',
  // Exercise & Fitness
  '🏋️', '🏃', '🚴', '🏊', '💪',
  // Study & Learning
  '📚', '🎓', '📖', '✏️', '📝',
  // Sleep & Rest
  '😴', '🛏️', '🌙', '💤', '🌃',
  // Food & Meals
  '🍽️', '🍕', '🍜', '🥗', '🍰',
  // Entertainment & Gaming
  '🎮', '🎬', '📺', '🎪', '🎡',
  // Art & Creativity
  '🎨', '🎭', '🖌️', '👩‍🎨', '✨',
  // Meditation & Wellness
  '🧘', '🧘‍♀️', '🕉️', '☮️', '💆',
  // Technology & Devices
  '📱', '💻', '⌨️', '🖥️', '⚡',
  // Travel & Transportation
  '🚗', '✈️', '🚆', '🚲', '🗺️',
  // Home & Family
  '🏠', '🏡', '👨‍👩‍👧‍👦', '🛋️', '🔑',
  // Nature & Outdoors
  '🌳', '🏕️', '⛰️', '🌲', '🏞️',
  // Music & Audio
  '🎵', '🎸', '🎤', '🎧', '🎹',
  // Shopping & Retail
  '🛒', '🛍️', '💳', '🏪', '🎁',
  // Health & Medical
  '💊', '👩‍⚕️', '🏥', '⚕️', '💉',
  // Pets & Animals
  '🐕', '🐈', '🐾', '🦮', '🐕‍🦺',
  // Sports & Competition
  '⚽', '🏀', '🎾', '🏆', '🥇',
  // Goals & Targets
  '🎯', '🏹', '🎖️', '📈', '🚀',
  // Ideas & Innovation
  '💡', '🔬', '🔭', '🧪', '⚙️',
  // Tools & DIY
  '🔧', '🔨', '🛠️', '⚒️', '🪛',
  // Coffee & Beverages
  '☕', '🍵', '🥤', '🧃', '🧋',
  // Photography & Media
  '📷', '📸', '🎥', '📹', '🎞️',
  // Travel Destinations
  '🏖️', '🌍', '🗼', '🗽', '🏰',
  // Achievements & Success
  '🌟', '⭐', '⚡', '🔥', '👍',
  // Love & Emotions
  '❤️', '🧡', '💛', '💚', '💙',
  // Food Items
  '🍎', '🍌', '🥑', '🍉', '🥕',
  // Money & Finance
  '💰', '💵', '💳', '📈', '💹',
  // Communication
  '✉️', '📧', '💬', '📞', '📱'
]

// Predefined color palette (9 colors + random button)
const colorPalette = [
  '#3b82f6', // Blue
  '#10b981', // Green
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#f97316', // Orange
  '#06b6d4', // Cyan
]

// Emoji mapping - Structured by category with multilingual keywords
// To add a new language: Add keywords to the appropriate category arrays
const emojiCategories = {
  work: {
    emoji: '💼',
    keywords: ['work', 'job', 'office', 'business', 'trabajo', 'oficina', 'negocio', 'empleo', 'travail', 'bureau', 'entreprise', 'emploi', 'trabalho', 'escritório', 'negócio', 'emprego', 'arbeit', 'büro', 'geschäft']
  },
  exercise: {
    emoji: '🏋️',
    keywords: ['exercise', 'workout', 'gym', 'fitness', 'ejercicio', 'gimnasio', 'exercice', 'salle de sport', 'exercício', 'academia', 'übung', 'fitnessstudio']
  },
  running: {
    emoji: '🏃',
    keywords: ['running', 'run', 'jog', 'correr', 'course', 'corrida', 'laufen']
  },
  cycling: {
    emoji: '🚴',
    keywords: ['cycling', 'bike', 'bicycle', 'ciclismo', 'vélo', 'radfahren']
  },
  swimming: {
    emoji: '🏊',
    keywords: ['swimming', 'swim', 'pool', 'natación', 'natation', 'natação', 'schwimmen']
  },
  muscle: {
    emoji: '💪',
    keywords: ['muscle', 'strength', 'strong', 'fuerza', 'force', 'força', 'kraft']
  },
  study: {
    emoji: '📚',
    keywords: ['study', 'learning', 'learn', 'estudio', 'aprendizaje', 'étude', 'apprentissage', 'estudo', 'aprendizado', 'studium', 'lernen']
  },
  education: {
    emoji: '🎓',
    keywords: ['education', 'school', 'university', 'college', 'educación', 'escuela', 'universidad', 'éducation', 'école', 'université', 'educação', 'escola', 'universidade', 'bildung', 'schule', 'universität']
  },
  reading: {
    emoji: '📖',
    keywords: ['reading', 'read', 'book', 'lectura', 'leer', 'lecture', 'lire', 'leitura', 'ler', 'lesen', 'buch']
  },
  sleep: {
    emoji: '😴',
    keywords: ['sleep', 'rest', 'nap', 'tired', 'dormir', 'descanso', 'siesta', 'sommeil', 'repos', 'sieste', 'sono', 'cochilo', 'schlaf', 'ruhe', 'nickerchen']
  },
  bed: {
    emoji: '🛏️',
    keywords: ['bed', 'bedtime', 'cama', 'lit', 'bett']
  },
  night: {
    emoji: '🌙',
    keywords: ['night', 'evening', 'noche', 'nuit', 'noite', 'nacht', 'abend']
  },
  food: {
    emoji: '🍽️',
    keywords: ['food', 'meal', 'eating', 'eat', 'breakfast', 'lunch', 'dinner', 'comida', 'desayuno', 'almuerzo', 'cena', 'nourriture', 'repas', 'petit-déjeuner', 'déjeuner', 'dîner', 'café da manhã', 'almoço', 'jantar', 'essen', 'mahlzeit', 'frühstück', 'mittagessen', 'abendessen']
  },
  cooking: {
    emoji: '🍳',
    keywords: ['cooking', 'cook', 'chef', 'cocinar', 'cuisine', 'cozinha', 'kochen']
  },
  gaming: {
    emoji: '🎮',
    keywords: ['gaming', 'games', 'game', 'play', 'juegos', 'jugar', 'jeux', 'jouer', 'jogos', 'jogar', 'spiele', 'spielen']
  },
  entertainment: {
    emoji: '🎬',
    keywords: ['entertainment', 'movie', 'film', 'cinema', 'entretenimiento', 'película', 'cine', 'divertissement', 'cinéma', 'entretenimento', 'filme', 'unterhaltung', 'kino']
  },
  tv: {
    emoji: '📺',
    keywords: ['tv', 'television', 'watch', 'netflix', 'televisión', 'télévision', 'televisão', 'fernsehen']
  },
  art: {
    emoji: '🎨',
    keywords: ['art', 'drawing', 'painting', 'creative', 'arte', 'dibujo', 'pintura', 'creativo', 'dessin', 'peinture', 'créatif', 'desenho', 'criativo', 'kunst', 'zeichnung', 'malerei', 'kreativ']
  },
  meditation: {
    emoji: '🧘',
    keywords: ['meditation', 'yoga', 'mindfulness', 'zen', 'meditación', 'méditation', 'meditação']
  },
  wellness: {
    emoji: '💆',
    keywords: ['wellness', 'spa', 'massage', 'relax', 'bienestar', 'bien-être', 'bem-estar']
  },
  coding: {
    emoji: '💻',
    keywords: ['coding', 'programming', 'development', 'developer', 'computer', 'tech', 'programación', 'desarrollo', 'computadora', 'tecnología', 'programmation', 'développement', 'ordinateur', 'technologie', 'programação', 'desenvolvimento', 'computador', 'tecnologia', 'programmierung', 'entwicklung', 'technologie']
  },
  phone: {
    emoji: '📱',
    keywords: ['phone', 'mobile', 'smartphone', 'teléfono', 'téléphone', 'telefone', 'telefon', 'handy']
  },
  travel: {
    emoji: '✈️',
    keywords: ['travel', 'trip', 'flight', 'airplane', 'viaje', 'voyage', 'viagem', 'reise', 'flug']
  },
  vacation: {
    emoji: '🏖️',
    keywords: ['vacation', 'holiday', 'beach', 'vacaciones', 'vacances', 'férias', 'urlaub', 'strand']
  },
  car: {
    emoji: '🚗',
    keywords: ['car', 'drive', 'driving', 'commute', 'coche', 'conducir', 'voiture', 'conduire', 'carro', 'dirigir', 'auto', 'fahren']
  },
  home: {
    emoji: '🏠',
    keywords: ['home', 'house', 'casa', 'hogar', 'maison', 'domicile', 'lar', 'haus', 'zuhause']
  },
  family: {
    emoji: '👨‍👩‍👧‍👦',
    keywords: ['family', 'familia', 'famille', 'família', 'familie']
  },
  nature: {
    emoji: '🌳',
    keywords: ['nature', 'outdoor', 'tree', 'naturaleza', 'exterior', 'extérieur', 'natureza', 'ar livre', 'natur', 'draußen']
  },
  hiking: {
    emoji: '⛰️',
    keywords: ['hiking', 'hike', 'mountain', 'senderismo', 'montaña', 'randonnée', 'montagne', 'caminhada', 'montanha', 'wandern', 'berg']
  },
  camping: {
    emoji: '🏕️',
    keywords: ['camping', 'camp', 'tent', 'campamento', 'acampar', 'camper', 'acampamento', 'zelten']
  },
  music: {
    emoji: '🎵',
    keywords: ['music', 'song', 'listen', 'música', 'canción', 'musique', 'chanson', 'música', 'canção', 'musik', 'lied']
  },
  guitar: {
    emoji: '🎸',
    keywords: ['guitar', 'guitarra', 'guitare', 'violão', 'gitarre']
  },
  singing: {
    emoji: '🎤',
    keywords: ['singing', 'sing', 'karaoke', 'cantar', 'chant', 'chanter', 'singen']
  },
  shopping: {
    emoji: '🛒',
    keywords: ['shopping', 'shop', 'buy', 'store', 'compras', 'tienda', 'achats', 'magasin', 'loja', 'einkaufen', 'geschäft', 'laden']
  },
  health: {
    emoji: '💊',
    keywords: ['health', 'medical', 'medicine', 'salud', 'médico', 'medicina', 'santé', 'médical', 'médicament', 'saúde', 'remédio', 'gesundheit', 'medizin']
  },
  doctor: {
    emoji: '👩‍⚕️',
    keywords: ['doctor', 'physician', 'médico', 'docteur', 'arzt']
  },
  hospital: {
    emoji: '🏥',
    keywords: ['hospital', 'clinic', 'hospital', 'hôpital', 'krankenhaus', 'klinik']
  },
  pet: {
    emoji: '🐕',
    keywords: ['pet', 'animal', 'mascota', 'animal de estimação', 'haustier']
  },
  dog: {
    emoji: '🐕',
    keywords: ['dog', 'puppy', 'perro', 'chien', 'cachorro', 'hund']
  },
  cat: {
    emoji: '🐈',
    keywords: ['cat', 'kitten', 'gato', 'chat', 'katze']
  },
  sports: {
    emoji: '⚽',
    keywords: ['sports', 'sport', 'soccer', 'football', 'deportes', 'fútbol', 'esportes', 'futebol', 'fußball']
  },
  basketball: {
    emoji: '🏀',
    keywords: ['basketball', 'baloncesto', 'basket', 'basquete']
  },
  goal: {
    emoji: '🎯',
    keywords: ['goal', 'target', 'objective', 'meta', 'objetivo', 'objectif', 'cible', 'ziel']
  },
  achievement: {
    emoji: '🏆',
    keywords: ['achievement', 'trophy', 'win', 'success', 'logro', 'éxito', 'réalisation', 'succès', 'conquista', 'sucesso', 'erfolg']
  },
  idea: {
    emoji: '💡',
    keywords: ['idea', 'innovation', 'think', 'innovación', 'pensar', 'idée', 'penser', 'ideia', 'pensar', 'idee', 'denken']
  },
  project: {
    emoji: '🚀',
    keywords: ['project', 'launch', 'startup', 'proyecto', 'lanzar', 'projet', 'lancer', 'projeto', 'lançar', 'projekt', 'start']
  },
  coffee: {
    emoji: '☕',
    keywords: ['coffee', 'café', 'kaffee']
  },
  tea: {
    emoji: '🍵',
    keywords: ['tea', 'té', 'thé', 'chá', 'tee']
  },
  photo: {
    emoji: '📷',
    keywords: ['photo', 'photography', 'camera', 'picture', 'foto', 'fotografía', 'cámara', 'photographie', 'appareil', 'fotografia', 'câmera', 'fotografie', 'kamera']
  },
  money: {
    emoji: '💰',
    keywords: ['money', 'finance', 'budget', 'cash', 'dinero', 'finanzas', 'presupuesto', 'argent', 'dinheiro', 'finanças', 'orçamento', 'geld', 'finanzen']
  },
  email: {
    emoji: '✉️',
    keywords: ['email', 'mail', 'message', 'correo', 'mensaje', 'courriel', 'courrier', 'e-mail', 'correio', 'mensagem', 'post', 'nachricht']
  },
  communication: {
    emoji: '💬',
    keywords: ['communication', 'chat', 'talk', 'comunicación', 'hablar', 'parler', 'comunicação', 'falar', 'kommunikation', 'sprechen']
  }
}

// Build flat emoji map from structured data
const emojiMap: Record<string, string> = {}
Object.values(emojiCategories).forEach(category => {
  category.keywords.forEach(keyword => {
    emojiMap[keyword.toLowerCase()] = category.emoji
  })
})

const sortedCategories = computed(() => {
  return [...store.categories].sort((a, b) => a.name.localeCompare(b.name))
})

const isMobile = computed(() => {
  return window.innerWidth <= 768
})

const modalTitle = computed(() => {
  return editingCategory.value ? t('categories.editCategory') : t('categories.addCategory')
})

// Generate random color
function generateRandomColor(): string {
  const letters = '0123456789ABCDEF'
  let color = '#'
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)]
  }
  return color
}

// Generate random emoji
function getRandomEmoji(): string {
  return commonIcons[Math.floor(Math.random() * commonIcons.length)]
}

// Suggest emoji based on category name
function suggestEmojiFromName(name: string): string {
  const lowerName = name.toLowerCase().trim()

  // Check for exact or partial matches in the emoji map
  for (const [key, emoji] of Object.entries(emojiMap)) {
    if (lowerName.includes(key) || key.includes(lowerName)) {
      return emoji
    }
  }

  // If no match found, return a default emoji
  return '💼'
}

// Watch for name changes to auto-suggest emoji
function onNameChange() {
  if (formData.value.name && !editingCategory.value) {
    const suggested = suggestEmojiFromName(formData.value.name)
    if (suggested !== formData.value.icon) {
      formData.value.icon = suggested
    }
  }
}

function openAddModal() {
  editingCategory.value = null
  formData.value = {
    name: '',
    color: '#3b82f6',
    weeklyHourLimit: 10,
    icon: '💼'
  }
  errorMessage.value = ''
  showModal.value = true
}

function openEditModal(category: Category) {
  editingCategory.value = category
  formData.value = {
    name: category.name,
    color: category.color,
    weeklyHourLimit: category.weeklyHourLimit,
    icon: category.icon || '💼'
  }
  errorMessage.value = ''
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  editingCategory.value = null
  errorMessage.value = ''
}

function saveCategory() {
  errorMessage.value = ''

  // Validation
  if (!formData.value.name.trim()) {
    errorMessage.value = t('categories.fields.nameRequired')
    return
  }

  if (formData.value.weeklyHourLimit < 0.5 || formData.value.weeklyHourLimit > 168) {
    errorMessage.value = t('categories.fields.weeklyLimitRequired')
    return
  }

  const categoryData = {
    name: formData.value.name.trim(),
    color: formData.value.color,
    weeklyHourLimit: formData.value.weeklyHourLimit,
    icon: formData.value.icon
  }

  let result
  if (editingCategory.value) {
    result = store.updateCategory(editingCategory.value.id, categoryData)
  } else {
    result = store.addCategory(categoryData)
  }

  if (result.success) {
    closeModal()
  } else {
    errorMessage.value = result.error || 'An error occurred'
  }
}

function openDeleteDialog(category: Category) {
  categoryToDelete.value = category
  showDeleteDialog.value = true
}

function confirmDelete() {
  if (categoryToDelete.value) {
    const result = store.deleteCategory(categoryToDelete.value.id)
    if (!result.success) {
      errorMessage.value = result.error || 'Failed to delete category'
    }
    categoryToDelete.value = null
  }
}

function cancelDelete() {
  categoryToDelete.value = null
}

function getCategoryStats(categoryId: string) {
  return store.categoryStats.find(stat => stat.categoryId === categoryId)
}
</script>

<template>
  <div class="category-manager">
    <div class="header">
      <h2>{{ t('categories.title') }}</h2>
      <button class="btn btn-primary btn-add-desktop" @click="openAddModal">
        + {{ t('categories.addCategory') }}
      </button>
    </div>

    <div class="categories-list">
      <div
        v-for="category in sortedCategories"
        :key="category.id"
        class="category-card"
      >
        <div class="category-header">
          <div class="category-title">
            <span class="category-icon">{{ category.icon }}</span>
            <h3>{{ category.name }}</h3>
          </div>
          <div class="category-actions">
            <button
              class="btn-icon btn-edit"
              type="button"
              @click="openEditModal(category)"
              title="Edit category"
            >
              ✏️
            </button>
            <button
              class="btn-icon btn-delete"
              type="button"
              @click="openDeleteDialog(category)"
              title="Delete category"
            >
              🗑️
            </button>
          </div>
        </div>

        <div class="category-stats">
          <div class="stat-row">
            <span class="stat-label">{{ t('categories.stats.weeklyLimit') }}</span>
            <span class="stat-value">{{ category.weeklyHourLimit }}{{ t('common.hours') }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">{{ t('categories.stats.used') }}</span>
            <span class="stat-value">
              {{ getCategoryStats(category.id)?.totalHours.toFixed(2) || '0.00' }}{{ t('common.hours') }}
            </span>
          </div>
          <div class="stat-row">
            <span class="stat-label">{{ t('categories.stats.remaining') }}</span>
            <span class="stat-value" :class="{
              'stat-warning': (getCategoryStats(category.id)?.remainingHours || 0) < 0,
              'stat-success': (getCategoryStats(category.id)?.remainingHours || 0) >= 0
            }">
              {{ getCategoryStats(category.id)?.remainingHours.toFixed(2) || category.weeklyHourLimit.toFixed(2) }}{{ t('common.hours') }}
            </span>
          </div>
        </div>

        <div class="progress-bar-container">
          <div
            class="progress-bar"
            :style="{
              width: `${Math.min(getCategoryStats(category.id)?.percentageOfLimit || 0, 100)}%`,
              backgroundColor: category.color
            }"
          ></div>
        </div>
        <div class="progress-label">
          {{ Math.round(getCategoryStats(category.id)?.percentageOfLimit || 0) }}% {{ t('categories.stats.ofLimit') }}
        </div>
      </div>

      <div v-if="sortedCategories.length === 0" class="empty-state">
        <div class="empty-icon">📋</div>
        <p class="empty-title">{{ t('categories.noCategories') }}</p>
        <p class="empty-description">{{ t('categories.noCategoriesDesc') }}</p>
      </div>
    </div>

    <!-- Add/Edit Modal (Desktop & Tablet) -->
    <BaseModal
      :show="showModal && !isMobile"
      :title="modalTitle"
      :show-footer="true"
      @close="closeModal"
    >
      <template #body>
        <div v-if="errorMessage" class="error-message">
          <span class="error-icon">⚠️</span>
          {{ errorMessage }}
        </div>

        <div class="form-group">
          <label for="category-name">{{ t('categories.fields.name') }} *</label>
          <input
            id="category-name"
            v-model="formData.name"
            type="text"
            :placeholder="t('categories.fields.namePlaceholder')"
            maxlength="50"
            class="form-input"
            @input="onNameChange"
            @keyup.enter="saveCategory"
          />
        </div>

        <div class="form-group">
          <div class="label-with-action">
            <label for="category-icon">{{ t('categories.fields.icon') }} *</label>
            <button
              type="button"
              class="btn-random"
              @click="formData.icon = getRandomEmoji()"
              :title="t('common.random')"
            >
              🎲 {{ t('common.random') }}
            </button>
          </div>
          <div class="icon-selector">
            <div class="selected-icon-display">
              <div class="selected-icon">{{ formData.icon }}</div>
              <span class="selected-label">{{ t('categories.selected') }}</span>
            </div>
            <div class="icon-grid-wrapper">
              <div class="icon-grid">
                <button
                  v-for="icon in commonIcons"
                  :key="icon"
                  type="button"
                  class="icon-option"
                  :class="{ active: formData.icon === icon }"
                  @click="formData.icon = icon"
                  :title="`Select ${icon}`"
                >
                  {{ icon }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="form-group">
          <div class="label-with-action">
            <label for="category-color">{{ t('categories.fields.color') }} *</label>
            <button
              type="button"
              class="btn-random"
              @click="formData.color = generateRandomColor()"
              :title="t('common.random')"
            >
              🎲 {{ t('common.random') }}
            </button>
          </div>
          <div class="color-selector">
            <div class="color-palette">
              <button
                v-for="color in colorPalette"
                :key="color"
                type="button"
                class="color-swatch"
                :class="{ active: formData.color === color }"
                :style="{ backgroundColor: color }"
                @click="formData.color = color"
                :title="color"
              >
                <span v-if="formData.color === color" class="checkmark">✓</span>
              </button>
            </div>
            <div class="custom-color-picker">
              <input
                id="category-color"
                v-model="formData.color"
                type="color"
                class="color-input"
              />
              <input
                v-model="formData.color"
                type="text"
                class="color-text-input"
                placeholder="#3b82f6"
                maxlength="7"
              />
            </div>
          </div>
        </div>

        <div class="form-group">
          <label for="category-limit">{{ t('categories.fields.weeklyLimit') }} *</label>
          <input
            id="category-limit"
            v-model.number="formData.weeklyHourLimit"
            type="number"
            min="0.5"
            max="168"
            step="0.5"
            class="form-input"
          />
          <small class="form-hint">{{ t('categories.fields.weeklyLimitHint') }}</small>
        </div>
      </template>

      <template #footer>
        <button class="btn btn-secondary" type="button" @click="closeModal">
          {{ t('common.cancel') }}
        </button>
        <button class="btn btn-primary" type="button" @click="saveCategory">
          <span v-if="editingCategory">{{ t('common.update') }}</span>
          <span v-else>{{ t('common.add') }}</span>
        </button>
      </template>
    </BaseModal>

    <!-- Add/Edit Bottom Sheet (Mobile) -->
    <BaseBottomSheet
      :show="showModal && isMobile"
      :title="modalTitle"
      :show-footer="true"
      @close="closeModal"
    >
      <template #body>
        <div v-if="errorMessage" class="error-message">
          <span class="error-icon">⚠️</span>
          {{ errorMessage }}
        </div>

        <div class="form-group">
          <label for="category-name-mobile">{{ t('categories.fields.name') }} *</label>
          <input
            id="category-name-mobile"
            v-model="formData.name"
            type="text"
            :placeholder="t('categories.fields.namePlaceholder')"
            maxlength="50"
            class="form-input"
            @input="onNameChange"
            @keyup.enter="saveCategory"
          />
        </div>

        <div class="form-group">
          <div class="label-with-action">
            <label for="category-icon-mobile">{{ t('categories.fields.icon') }} *</label>
            <button
              type="button"
              class="btn-random"
              @click="formData.icon = getRandomEmoji()"
              :title="t('common.random')"
            >
              🎲 {{ t('common.random') }}
            </button>
          </div>
          <div class="icon-selector">
            <div class="selected-icon-display">
              <div class="selected-icon">{{ formData.icon }}</div>
              <span class="selected-label">{{ t('categories.selected') }}</span>
            </div>
            <div class="icon-grid-wrapper">
              <div class="icon-grid">
                <button
                  v-for="icon in commonIcons"
                  :key="icon"
                  type="button"
                  class="icon-option"
                  :class="{ active: formData.icon === icon }"
                  @click="formData.icon = icon"
                  :title="`Select ${icon}`"
                >
                  {{ icon }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="form-group">
          <div class="label-with-action">
            <label for="category-color-mobile">{{ t('categories.fields.color') }} *</label>
            <button
              type="button"
              class="btn-random"
              @click="formData.color = generateRandomColor()"
              :title="t('common.random')"
            >
              🎲 {{ t('common.random') }}
            </button>
          </div>
          <div class="color-selector">
            <div class="color-palette">
              <button
                v-for="color in colorPalette"
                :key="color"
                type="button"
                class="color-swatch"
                :class="{ active: formData.color === color }"
                :style="{ backgroundColor: color }"
                @click="formData.color = color"
                :title="color"
              >
                <span v-if="formData.color === color" class="checkmark">✓</span>
              </button>
            </div>
            <div class="custom-color-picker">
              <input
                id="category-color-mobile"
                v-model="formData.color"
                type="color"
                class="color-input"
              />
              <input
                v-model="formData.color"
                type="text"
                class="color-text-input"
                placeholder="#3b82f6"
                maxlength="7"
              />
            </div>
          </div>
        </div>

        <div class="form-group">
          <label for="category-limit-mobile">{{ t('categories.fields.weeklyLimit') }} *</label>
          <input
            id="category-limit-mobile"
            v-model.number="formData.weeklyHourLimit"
            type="number"
            min="0.5"
            max="168"
            step="0.5"
            class="form-input"
          />
          <small class="form-hint">{{ t('categories.fields.weeklyLimitHint') }}</small>
        </div>
      </template>

      <template #footer>
        <button class="btn btn-secondary" type="button" @click="closeModal">
          {{ t('common.cancel') }}
        </button>
        <button class="btn btn-primary" type="button" @click="saveCategory">
          <span v-if="editingCategory">{{ t('common.update') }}</span>
          <span v-else>{{ t('common.add') }}</span>
        </button>
      </template>
    </BaseBottomSheet>

    <!-- Floating Action Button (Mobile Only) -->
    <button class="fab fab-mobile" @click="openAddModal" :title="t('categories.addCategory')">
      +
    </button>

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog
      v-model="showDeleteDialog"
      type="danger"
      :title="t('common.delete')"
      :message="t('categories.deleteConfirm', { name: categoryToDelete?.name })"
      :confirm-text="t('common.delete')"
      :cancel-text="t('common.cancel')"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
  </div>
</template>

<style scoped>
.category-manager {
  padding: 0;
}

.header {
  margin-bottom: 2rem;
  padding: 2rem 2rem 0 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header h2 {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
  color: #1f2937;
}

.btn-add-desktop {
  display: inline-flex;
}

/* Hide button on mobile */
@media (max-width: 768px) {
  .btn-add-desktop {
    display: none;
  }
}

/* Floating Action Button (Mobile Only) */
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
  display: none;  /* Hidden by default */
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

/* Show FAB only on mobile */
@media (max-width: 768px) {
  .fab-mobile {
    display: flex;
  }
}

.categories-list {
  display: grid;
  gap: 1.25rem;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  padding: 0 2rem 2rem 2rem;
}

.category-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 0.75rem;
  padding: 1.5rem;
  transition: all 0.2s;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
}

.category-card:hover {
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  transform: translateY(-2px);
}

.category-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.25rem;
}

.category-title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.category-icon {
  font-size: 2rem;
  line-height: 1;
}

.category-title h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
}

.category-actions {
  display: flex;
  gap: 0.5rem;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.category-card:hover .category-actions {
  opacity: 1;
}

.category-stats {
  margin-bottom: 1rem;
  background: #f9fafb;
  padding: 1rem;
  border-radius: 0.5rem;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  padding: 0.375rem 0;
  font-size: 0.9375rem;
}

.stat-row:not(:last-child) {
  border-bottom: 1px solid #e5e7eb;
}

.stat-label {
  color: #6b7280;
  font-weight: 500;
}

.stat-value {
  font-weight: 600;
  color: #1f2937;
}

.stat-warning {
  color: #dc2626;
}

.stat-success {
  color: #10b981;
}

.progress-bar-container {
  width: 100%;
  height: 0.625rem;
  background: #e5e7eb;
  border-radius: 0.5rem;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.progress-bar {
  height: 100%;
  transition: width 0.3s ease;
  border-radius: 0.5rem;
}

.progress-label {
  font-size: 0.8125rem;
  color: #6b7280;
  text-align: center;
  font-weight: 500;
}

.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 4rem 2rem;
  color: #6b7280;
}

.empty-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
  opacity: 0.5;
}

.empty-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #374151;
  margin: 0 0 0.5rem 0;
}

.empty-description {
  margin: 0;
  color: #6b7280;
}

/* Buttons */
.btn {
  padding: 0.625rem 1.25rem;
  border: none;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.btn:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-primary:hover {
  background: #2563eb;
  transform: translateY(-1px);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.btn-secondary {
  background: #f3f4f6;
  color: #374151;
}

.btn-secondary:hover {
  background: #e5e7eb;
}

.btn-icon {
  font-size: 1rem;
  font-weight: 700;
}

.btn-icon {
  background: none;
  border: none;
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 0.375rem;
  transition: all 0.2s;
  line-height: 1;
}

.btn-edit:hover {
  background: #dbeafe;
}

.btn-delete:hover {
  background: #fee2e2;
}

/* Modal and Form Content */
.error-message {
  background: #fee2e2;
  color: #dc2626;
  padding: 0.875rem 1rem;
  border-radius: 0.5rem;
  margin-bottom: 1.5rem;
  font-size: 0.9375rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid #fecaca;
}

.error-icon {
  font-size: 1.25rem;
}

.form-group {
  margin-bottom: 1.5rem;
}

.label-with-action {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.625rem;
}

.label-with-action label {
  margin-bottom: 0;
}

.btn-random {
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: #374151;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.btn-random:hover {
  background: #e5e7eb;
  transform: translateY(-1px);
}

.form-group label {
  display: block;
  margin-bottom: 0.625rem;
  font-weight: 600;
  color: #374151;
  font-size: 0.9375rem;
}

.form-input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  transition: all 0.2s;
}

.form-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-hint {
  display: block;
  margin-top: 0.375rem;
  color: #6b7280;
  font-size: 0.8125rem;
}

.icon-selector {
  display: flex;
  gap: 1.25rem;
  align-items: flex-start;
}

.selected-icon-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.selected-icon {
  font-size: 3.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 5.5rem;
  height: 5.5rem;
  border: 2px solid #e5e7eb;
  border-radius: 0.75rem;
  background: #f9fafb;
  flex-shrink: 0;
}

.selected-label {
  font-size: 0.75rem;
  color: #6b7280;
  font-weight: 500;
}

.icon-grid-wrapper {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  border: 2px solid #e5e7eb;
  border-radius: 0.75rem;
  padding: 0.75rem;
  background: #f9fafb;
  min-width: 0;
  max-width: 100%;
}

.icon-grid {
  display: grid;
  grid-template-rows: repeat(5, auto);
  grid-auto-flow: column;
  gap: 0.5rem;
  align-items: center;
  width: max-content;
}

.icon-option {
  font-size: 1.5rem;
  padding: 0.5rem;
  background: #f9fafb;
  border: 2px solid #e5e7eb;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  flex-shrink: 0;
}

.icon-option:hover {
  background: #e5e7eb;
  transform: scale(1.1);
}

.icon-option.active {
  border-color: #3b82f6;
  background: #dbeafe;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.color-selector {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.color-palette {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.5rem;
  margin: -0.5rem;
}

.color-swatch {
  width: 2.5rem;
  height: 2.5rem;
  border: 2px solid #e5e7eb;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  flex-shrink: 0;
  margin: 0.25rem;
}

.color-swatch:hover {
  transform: scale(1.15);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  z-index: 1;
}

.color-swatch.active {
  border-color: #1f2937;
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.1);
}

.checkmark {
  color: white;
  font-size: 1rem;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.custom-color-picker {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.color-input {
  width: 4.5rem;
  height: 3rem;
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
  cursor: pointer;
  padding: 0.25rem;
}

.color-text-input {
  flex: 1;
  padding: 0.625rem 0.875rem;
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-family: monospace;
}

.color-text-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

/* Responsive */
@media (min-width: 1025px) {
  .categories-list {
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }
}

@media (max-width: 1024px) and (min-width: 769px) {
  .header {
    padding: 1.5rem 1.5rem 0 1.5rem;
  }

  .categories-list {
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    padding: 0 1.5rem 1.5rem 1.5rem;
  }
}

@media (max-width: 768px) {
  .btn-add-desktop {
    display: none !important;
  }

  .header {
    padding: 1rem 1rem 0.75rem 1rem;
    background: white;
    border-bottom: none;
    justify-content: center;
  }

  .header h2 {
    font-size: 1.25rem;
    font-weight: 600;
    text-align: center;
  }

  .categories-list {
    grid-template-columns: 1fr;
    padding: 1rem;
    gap: 1rem;
  }

  .category-card {
    border-radius: 0.75rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    padding: 1.25rem;
  }

  .category-card:active {
    transform: scale(0.98);
  }

  .category-icon {
    font-size: 1.75rem;
  }

  .category-title h3 {
    font-size: 1.125rem;
  }

  .category-stats {
    background: #f9fafb;
    padding: 0.875rem;
  }

  .stat-row {
    font-size: 0.875rem;
  }

  .icon-grid {
    grid-template-columns: repeat(4, 1fr);
  }

  .icon-selector {
    flex-direction: column;
  }

  .selected-icon-display {
    width: 100%;
  }

  .selected-icon {
    width: 100%;
  }

  .color-palette {
    grid-template-columns: repeat(5, 1fr);
  }

  .fab-mobile {
    bottom: calc(1.5rem + env(safe-area-inset-bottom));
  }
}

@media (max-width: 480px) {
  .category-icon {
    font-size: 1.5rem;
  }

  .category-title h3 {
    font-size: 1.125rem;
  }

  .icon-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
