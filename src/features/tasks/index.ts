import type { ShellRegistry } from '@/app/contracts'
import TasksView from './TasksView.vue'

export default function registerTasks(registry: ShellRegistry): void {
  registry.registerView({
    id: 'tasks',
    component: TasksView,
    titleKey: 'app.tabs.tasks',
    icon: 'list-checks',
    tabOrder: 2,
  })
}
