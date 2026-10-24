import type { ShellRegistry } from '@/app/contracts'
import CheckInView from './CheckInView.vue'
import { reminderEnabled, startReminderTicker } from './reminder'

export default function registerCheckIn(registry: ShellRegistry): void {
  registry.registerView({ id: 'checkin', component: CheckInView, titleKey: 'checkin.title' })
  if (reminderEnabled()) startReminderTicker()
}
