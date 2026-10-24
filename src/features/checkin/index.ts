import type { ShellRegistry } from '@/app/contracts'
import CheckInView from './CheckInView.vue'

export default function registerCheckIn(registry: ShellRegistry): void {
  registry.registerView({ id: 'checkin', component: CheckInView, titleKey: 'checkin.title' })
}
