<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { proposalInputSchema } from '@/core/model'
import { usePlannerStore } from '@/stores/plannerStore'
import { companionMode } from '@/repositories/CompanionRepository'
import { createBrowserRepositories } from '@/repositories/browserRepositories'
import { getProposalRepository } from '@/features/proposals/repository'
import { refreshPending, pendingCount } from '@/features/proposals/pending'
import Button from '@/ui/Button.vue'
import { importCompanionBundle, snapshotAndPrompt } from './transfer'

const { t } = useI18n()
const planner = usePlannerStore()
const proposalJson = ref('')
const status = ref('')
const busy = ref(false)
const desktopConfig = JSON.stringify({ mcpServers: { next168: { command: 'node', args: ['/absolute/path/to/next168/companion/dist/cli.js', 'mcp'] } } }, null, 2)
const codeCommand = 'claude mcp add --transport stdio next168 -- node /absolute/path/to/next168/companion/dist/cli.js mcp'
const empty = computed(() => planner.document && !planner.document.categories.length && !planner.document.blocks.length && !planner.document.tasks.length && !planner.document.events.length)
async function downloadSnapshot() {
  if (!planner.document) return
  if (!companionMode && (await createBrowserRepositories().planner.load()).kind === 'empty') {
    const result = await planner.commit(() => undefined)
    if (!result.ok) { status.value = t('connect.importError'); return }
  }
  const blob = new Blob([snapshotAndPrompt(planner.document)], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = 'next168-snapshot-and-prompt.txt'; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function importProposal() {
  if (busy.value) return
  busy.value = true; status.value = ''
  try {
    if (new TextEncoder().encode(proposalJson.value).length > 256 * 1024) throw Error('proposal-too-large')
    const input = proposalInputSchema.parse(JSON.parse(proposalJson.value))
    await getProposalRepository().create(input, 'import', { basis: planner.document ?? undefined })
    proposalJson.value = ''; await refreshPending(); location.hash = '#/proposals'
  } catch { status.value = t('connect.importError') }
  finally { busy.value = false }
}
async function importWorkspace(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  busy.value = true; status.value = ''
  try {
    if (file.size > 120 * 1024 * 1024) throw Error('bundle-too-large')
    await importCompanionBundle(await file.text())
    await planner.load(); status.value = t('connect.importVerified')
  } catch { status.value = t('connect.workspaceImportError') }
  finally { busy.value = false; input.value = '' }
}
</script>

<template>
  <div class="connect-settings">
    <h2 class="section-header">{{ t('connect.title') }}</h2>
    <template v-if="companionMode">
      <h3 class="t-headline local-title">{{ t('connect.local.title') }}</h3>
      <p class="t-subhead t-secondary local-hint">{{ t('connect.local.hint') }}</p>
    </template>
    <section v-if="companionMode && empty" class="connect-card">
      <p class="t-subhead t-secondary">{{ t('connect.transferHint') }}</p>
      <label class="import-workspace">
        {{ t('connect.importWorkspace') }}
        <input type="file" accept="application/json,.json" :disabled="busy" @change="importWorkspace" />
      </label>
    </section>
    <section v-if="companionMode" class="connect-card">
      <h3 class="t-headline">Claude Desktop</h3>
      <p class="t-subhead t-secondary">{{ t('connect.desktopInstructions') }}</p>
      <pre>{{ desktopConfig }}</pre>
      <h3 class="t-headline">Claude Code</h3>
      <pre>{{ codeCommand }}</pre>
      <p class="t-footnote">{{ t('connect.customHome') }}</p>
      <p>{{ t('connect.rotateHint') }} <code>node companion/dist/cli.js token rotate</code></p>
    </section>
    <section class="connect-card">
      <p class="t-subhead t-secondary">{{ t('connect.privacy') }}</p>
      <p class="t-subhead t-secondary">{{ t('connect.chatgpt') }}</p>
      <Button variant="tinted" :disabled="!planner.document" @click="downloadSnapshot">{{ t('connect.exportSnapshot') }}</Button>
      <label for="proposal-json">{{ t('connect.importProposal') }}</label>
      <textarea id="proposal-json" v-model="proposalJson" rows="7" spellcheck="false" :placeholder="t('connect.proposalPlaceholder')" />
      <Button variant="tinted" :disabled="busy || !proposalJson.trim() || !planner.writable" @click="importProposal">{{ t('connect.importProposal') }}</Button>
      <a href="#/proposals">{{ t('proposals.pending', { count: pendingCount }, pendingCount) }}</a>
    </section>
    <p v-if="status" role="status">{{ status }}</p>
  </div>
</template>

<style scoped>
.connect-settings { padding: var(--space-4); }
.local-title { margin-top: var(--space-6); }
.local-hint { margin-top: var(--space-1); }
/* One column that may shrink below its content's natural width (a textarea is 20 characters wide by default), so
   200 % text never widens the page. */
.connect-card { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); margin-block: var(--space-4); padding: var(--space-4); background: var(--surface); border-radius: var(--radius-card); }
.connect-card textarea { width: 100%; min-width: 0; box-sizing: border-box; }
/* Long German compounds ("Betriebssystemsitzung") break instead of spilling out at 200 % text. */
.connect-card :is(p, label, a, h3) { overflow-wrap: anywhere; hyphens: auto; }
pre, code { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.8125rem; }
pre { background: var(--surface-2); border-radius: var(--radius-control); padding: var(--space-3); }
textarea { width: 100%; border: 1px solid var(--field-border); border-radius: var(--radius-control); background: var(--surface-2); color: var(--label); padding: var(--space-3); resize: vertical; }
a { color: var(--tint-label); min-height: var(--tap-target); display: flex; align-items: center; }
.import-workspace { display: grid; gap: var(--space-2); }
input[type='file'] { min-height: var(--tap-target); max-width: 100%; }
</style>
