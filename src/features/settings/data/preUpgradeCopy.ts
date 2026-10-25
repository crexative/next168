import { portableHash } from '@/core/exportBundle'
import { preUpgradeBundle, type PreUpgradeCopy } from '@/repositories/storageVersion'
import { MAX_IMPORT_BYTES } from './dataTransfer'

export interface DownloadFile { fileName: string; json: string; bytes: number }

export interface PreUpgradeFiles {
  capturedAt: string
  // The export bundle, offered only when its portable hash equals the one recorded at capture.
  bundle?: DownloadFile & { tooLarge: boolean }
  // Every captured record and calendar text, as stored.
  raw: DownloadFile
}

function file(fileName: string, json: string): DownloadFile {
  return { fileName, json, bytes: new Blob([json]).size }
}

export async function preUpgradeFiles(copy: PreUpgradeCopy): Promise<PreUpgradeFiles> {
  const day = copy.capturedAt.slice(0, 10)
  const raw = file(`next168-before-update-raw-${day}.json`, JSON.stringify(copy, null, 2))
  const bundle = preUpgradeBundle(copy)
  const verified = bundle !== null && copy.portableHash !== null && (await portableHash(bundle)) === copy.portableHash
  if (!verified) return { capturedAt: copy.capturedAt, raw }
  // The same serialization as every export, so its size is the size the import gate measures.
  const exported = file(`next168-before-update-${day}.json`, JSON.stringify(bundle, null, 2))
  return { capturedAt: copy.capturedAt, raw, bundle: { ...exported, tooLarge: exported.bytes > MAX_IMPORT_BYTES } }
}

export function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

export function saveFile({ fileName, json }: DownloadFile): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = window.document.createElement('a')
  link.href = url
  link.download = fileName
  window.document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
