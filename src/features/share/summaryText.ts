import { i18n } from '@/i18n'
import { displayLocaleFor, formatTotal, formatWholeHours, formatWholeNumber } from '@/ui/format'
import { displayPublicUrl } from '../../../config/publicUrl'
import type { CardCopy } from './layout'
import type { ShareSummary } from './shareSummary'

type ListFormatter = new (locale: string, options: { type: 'unit' }) => { format(items: string[]): string }

// Intl.ListFormat ("Sleep 49 h, Work 40 h, Gym 3 h"); the TS target's lib does not declare it yet.
function listOf(items: string[], locale: string): string {
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormatter }).ListFormat
  return ListFormat ? new ListFormat(locale, { type: 'unit' }).format(items) : items.join(', ')
}

export type Translate = (key: string, named?: Record<string, unknown>) => string

function currentLanguage(): string {
  return i18n.global.locale.value
}

// The card's words, from the summary alone.
export function cardCopy(summary: ShareSummary, t: Translate, language: string = currentLanguage()): CardCopy {
  const locale = displayLocaleFor(language)
  return {
    label: t('share.label'),
    headline: t('share.headline', { assigned: formatWholeHours(summary.assignedHours, locale) }),
    headlineFigure: formatWholeHours(summary.assignedHours, locale),
    caption: summary.overlap ? t('share.overlapHint', { total: formatWholeNumber(summary.plannedTotalHours, locale) }) : t('share.cellHint'),
    footer: summary.publicUrl ? t('share.footer', { url: displayPublicUrl(summary.publicUrl) }) : t('share.footerNoUrl', { app: summary.brandName }),
    hours: (minutes) => formatTotal(minutes, locale),
    others: (count) => t('share.others', { count: formatWholeNumber(count, locale) }),
  }
}

// One string for the preview's alt, the selectable text beside it and the text handed to the share sheet, so the
// figures survive without the bitmap. Category names and hours only: never routine titles, even with names on.
export function summaryText(summary: ShareSummary, t: Translate, language: string = currentLanguage()): string {
  const locale = displayLocaleFor(language)
  const categories = listOf(summary.categories.map((category) => `${category.name} ${formatTotal(category.plannedMinutes, locale)}`), locale)
  const params = {
    app: summary.brandName,
    assigned: formatWholeHours(summary.assignedHours, locale),
    total: formatWholeNumber(summary.plannedTotalHours, locale),
    categories,
  }
  const text = t(summary.overlap ? 'share.textOverlap' : 'share.text', params)
  return summary.publicUrl ? `${text} ${summary.publicUrl}` : text
}
