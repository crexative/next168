<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BRAND } from '@/app/brand'
import { activePlannerRepository, usePlannerStore } from '@/stores/plannerStore'
import { appearance } from '@/ui/appearance'
import { announce } from '@/ui/announcer'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import SegmentedControl from '@/ui/SegmentedControl.vue'
import Sheet from '@/ui/Sheet.vue'
import ToggleRow from '@/ui/ToggleRow.vue'
import { useMediaQuery } from '@/ui/useMediaQuery'
import { CARD_FORMATS, type ShareFormat } from './layout'
import { encodePng, renderCardCanvas } from './paint'
import { paletteFor, type ShareTheme } from './palette'
import { buildShareSummary } from './shareSummary'
import { cardCopy, summaryText } from './summaryText'
import { useShareArtifact, type ShareArtifact, type ShareInputs } from './useShareArtifact'

const open = defineModel<boolean>('open', { required: true })

const { t, locale } = useI18n()
const planner = usePlannerStore()
const systemDark = useMediaQuery('(prefers-color-scheme: dark)')

const format = ref<ShareFormat>('story')
// Off by default and never remembered: routine names leave the device only when turned on for this image.
const includeNames = ref(false)
const status = ref<{ tone: 'ok' | 'error'; text: string } | null>(null)
const loadedKey = ref<string | null>(null)
const summaryParagraph = ref<HTMLElement | null>(null)

// The same source as the app's appearance: the stored choice, or the system's when it is Automatic.
const theme = computed<ShareTheme>(() => (appearance.value === 'auto' ? (systemDark.value ? 'dark' : 'light') : appearance.value))

function inputs(): ShareInputs | null {
  const document = planner.document
  if (!open.value || !document) return null
  return {
    workspaceId: document.workspaceId,
    purgeEpoch: activePlannerRepository().knownPurgeEpoch?.() ?? 'none',
    revision: document.revision,
    includeNames: includeNames.value,
    format: format.value,
    theme: theme.value,
    locale: locale.value,
    brandName: BRAND.name,
    ...(BRAND.publicUrl ? { publicUrl: BRAND.publicUrl } : {}),
  }
}

const artifact = useShareArtifact(inputs, {
  summarize: (input) => buildShareSummary(planner.document!, { includeNames: input.includeNames, brand: { name: input.brandName, slug: BRAND.slug, publicUrl: input.publicUrl } }),
  paint: (summary, input) => renderCardCanvas(summary, { format: input.format, copy: cardCopy(summary, t, input.locale), palette: paletteFor(input.theme) }),
  encode: encodePng,
  fileName: () => `${BRAND.slug}-${t('share.fileStem')}.png`,
})

// The words of the image, never routine titles: the preview's alt, the selectable text and the shared text.
const text = computed(() => {
  const document = planner.document
  if (!document) return ''
  return summaryText(buildShareSummary(document, { includeNames: false, brand: BRAND }), t, locale.value)
})

const canShareFiles = (() => {
  try {
    return typeof navigator.share === 'function' && navigator.canShare?.({ files: [new File([], 'probe.png', { type: 'image/png' })] }) === true
  } catch {
    return false
  }
})()

const preparing = computed(() => artifact.ready.value === null && !artifact.failed.value)
const actionable = computed(() => {
  const ready = artifact.ready.value
  return ready !== null && ready.key === artifact.key.value && loadedKey.value === ready.key
})
const previewShape = computed(() => {
  const { width, height } = CARD_FORMATS[format.value]
  return { aspectRatio: `${width} / ${height}`, '--ratio': String(width / height) }
})

watch(artifact.key, () => { status.value = null })
watch(open, (isOpen) => {
  if (isOpen) return
  format.value = 'story'
  includeNames.value = false
  loadedKey.value = null
})

function onPreviewLoaded(shown: ShareArtifact | null): void {
  if (!shown || shown !== artifact.ready.value) return
  loadedKey.value = shown.key
  artifact.markReady(shown)
  announce(t('share.ready'))
}

// The artifact a tap may hand out: the one prepared for exactly what the sheet shows now.
function current(): ShareArtifact | null {
  const ready = artifact.ready.value
  return ready && ready.key === artifact.key.value && actionable.value ? ready : null
}

let busy = false
function onShare(): void {
  const ready = current()
  if (!ready || busy) return
  busy = true
  artifact.markHandoff()
  // No await before share(): it needs the tap's activation.
  navigator.share({ files: [ready.file], title: t('share.title'), text: text.value })
    .then(() => { status.value = null })
    .catch((failure: unknown) => {
      const name = failure instanceof Error ? failure.name : 'Error'
      status.value = name === 'AbortError' ? null : { tone: 'error', text: t('share.failed', { reason: name }) }
    })
    .finally(() => { busy = false })
}

function onDownload(): void {
  const ready = current()
  if (!ready) return
  artifact.markHandoff()
  const link = window.document.createElement('a')
  link.href = ready.url
  link.download = ready.file.name
  window.document.body.appendChild(link)
  link.click()
  link.remove()
}

async function onCopy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(text.value)
    status.value = { tone: 'ok', text: t('share.copied') }
    announce(t('share.copied'))
  } catch {
    // Without the clipboard the text is selected, ready to copy by hand.
    const paragraph = summaryParagraph.value
    const selection = window.getSelection()
    if (paragraph && selection) selection.selectAllChildren(paragraph)
  }
}

const formatOptions = computed(() => [
  { value: 'story' as const, label: t('share.format.story') },
  { value: 'square' as const, label: t('share.format.square') },
])
</script>

<template>
  <Sheet v-model:open="open" :title="t('share.title')" :dismiss-label="t('common.close')">
    <div class="share" data-testid="share-sheet">
      <figure class="preview" :class="{ 'is-stale': preparing }" :style="previewShape" :aria-busy="preparing || undefined">
        <img
          v-if="artifact.preview.value"
          :key="artifact.preview.value.url"
          class="preview-image"
          :src="artifact.preview.value.url"
          :alt="text"
          data-testid="share-preview"
          @load="onPreviewLoaded(artifact.preview.value)"
          @error="onPreviewLoaded(artifact.preview.value)"
        >
      </figure>

      <section class="summary" :aria-label="t('share.summaryLabel')">
        <p ref="summaryParagraph" class="t-subhead summary-text" data-testid="share-summary-text">{{ text }}</p>
        <Button variant="plain" data-testid="share-copy" @click="onCopy">
          <Icon name="copy" :size="20" />{{ t('share.copyText') }}
        </Button>
        <p class="t-footnote t-secondary note">{{ t('share.textNote') }}</p>
      </section>

      <SegmentedControl v-model="format" :options="formatOptions" :label="t('share.format.label')" />

      <div class="names">
        <ul class="list-card"><ToggleRow v-model="includeNames" :label="t('share.showNames')" test-id="share-names" /></ul>
        <p class="t-footnote t-secondary note">{{ t('share.showNamesFootnote') }}</p>
      </div>

      <p v-if="artifact.failed.value" class="t-subhead notice is-error" role="alert" data-testid="share-failed">{{ t('share.failed', { reason: 'encode' }) }}</p>
      <p v-else-if="status" class="t-subhead notice" :class="`is-${status.tone}`" :role="status.tone === 'error' ? 'alert' : 'status'" data-testid="share-status">{{ status.text }}</p>
    </div>

    <template #footer>
      <div class="actions">
        <Button v-if="canShareFiles" :disabled="!actionable" data-testid="share-primary" @click="onShare">
          <Icon name="share" :size="20" />{{ t('share.action.share') }}
        </Button>
        <Button :variant="canShareFiles ? 'tinted' : 'filled'" :disabled="!actionable" :data-testid="canShareFiles ? 'share-download' : 'share-primary'" @click="onDownload">
          <Icon name="download" :size="20" />{{ t('share.action.download') }}
        </Button>
      </div>
    </template>
  </Sheet>
</template>

<style scoped>
.share { display: flex; flex-direction: column; gap: var(--group-gap); }
/* The preview is the image that will be sent: never cropped, at most a little over half the screen high. */
.preview {
  display: grid;
  place-items: center;
  align-self: center;
  /* As wide as the sheet allows while its height stays within 55 % of the screen. */
  inline-size: min(100%, calc(55dvh * var(--ratio)));
  max-block-size: 55dvh;
  margin: 0;
  border-radius: var(--radius-card);
  background: var(--surface-2);
  box-shadow: 0 0 0 1px var(--separator);
  overflow: hidden;
  transition: opacity 0.15s;
}
.preview.is-stale { opacity: 0.5; }
.preview-image { display: block; width: 100%; height: 100%; object-fit: contain; }
.summary { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-1); }
.summary-text { margin: 0; user-select: text; -webkit-user-select: text; overflow-wrap: break-word; }
.note { margin: 0; }
.names { display: flex; flex-direction: column; gap: var(--space-2); }
.names .note { padding: 0 var(--card-padding); }
.list-card { margin: 0; padding: 0; list-style: none; background: var(--surface-2); border-radius: var(--radius-card); overflow: hidden; }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
/* Side by side when both labels fit on one line; on a phone each action takes its own full-width row. */
.actions > * { flex: 1 1 12rem; min-height: 48px; }
.notice { margin: 0; padding: var(--space-3) var(--card-padding); border-radius: var(--radius-card); overflow-wrap: break-word; }
.notice.is-ok { background: color-mix(in srgb, var(--success) 14%, transparent); }
.notice.is-error { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger-label); }
/* A centred sheet on a wide screen: the image on the left, its text and options beside it, all in view at once. */
@media (min-width: 768px) {
  .share { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; gap: var(--group-gap) var(--space-6); }
  .preview { grid-column: 1; grid-row: 1 / span 5; align-self: start; }
  .share > :not(.preview) { grid-column: 2; }
}
@media (prefers-reduced-motion: reduce) {
  .preview { transition: none; }
}
</style>
