import { ChevronDown, ChevronUp, Trash2 } from 'lucide-vue-next'
import { registerIcons } from '@/ui/icons'

// The icons Tasks adds to the shared registry; every Tasks component that draws one imports this module.
registerIcons({ 'chevron-down': ChevronDown, 'chevron-up': ChevronUp, 'trash-2': Trash2 })
