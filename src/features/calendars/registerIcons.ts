import { ChevronDown, ChevronUp } from 'lucide-vue-next'
import { registerIcons } from '@/ui/icons'

// The icons the event sheet adds to the shared registry; the sheet imports this module.
registerIcons({ 'chevron-down': ChevronDown, 'chevron-up': ChevronUp })
