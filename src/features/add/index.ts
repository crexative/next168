import type { ShellRegistry } from '@/app/contracts'
import AddEntry from './AddEntry.vue'

export default function registerAdd(registry: ShellRegistry): void {
  registry.registerAddEntry({ component: AddEntry })
}
