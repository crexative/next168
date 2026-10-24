import { Calendar1, ChevronLeft, Columns3, Minus } from 'lucide-vue-next'
import { registerIcons } from '@/ui/icons'

// The icons Week adds to the shared registry; every Week component that draws one imports this module.
registerIcons({ 'calendar-1': Calendar1, 'chevron-left': ChevronLeft, 'columns-3': Columns3, minus: Minus })
