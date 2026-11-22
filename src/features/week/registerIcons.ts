import { ChevronLeft, Minus } from 'lucide-vue-next'
import { registerIcons } from '@/ui/icons'

// The icons Week adds to the shared registry; every Week component that draws one imports this module.
registerIcons({ 'chevron-left': ChevronLeft, minus: Minus })
