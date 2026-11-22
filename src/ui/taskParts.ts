import { useI18n } from 'vue-i18n'
import type { PartLabel } from '@/core/scheduling'

// A piece of a split task is shown compactly ("1/2 Llamar al banco") and heard as that with its part in words
// ("1/2 Llamar al banco, parte 1 de 2"): the name a screen reader or voice control uses starts with what is on screen
// (WCAG 2.5.3, label in name). Week and Today share these two.
export function useTaskPartLabels(): { partLabel: PartLabel; partSpoken: PartLabel } {
  const { t } = useI18n()
  const partLabel: PartLabel = (title, part, parts) => t('common.taskPart', { title, part, parts })
  const partSpoken: PartLabel = (title, part, parts) => t('common.taskPartSpoken', { title: partLabel(title, part, parts), part, parts })
  return { partLabel, partSpoken }
}
