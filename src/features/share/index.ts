import { Copy, Download, Share } from 'lucide-vue-next'
import { registerIcons } from '@/ui/icons'

// The share card is not a view: Summary mounts its entry. This module only adds its icons to the shared registry.
export default function registerShare(): void {
  registerIcons({ share: Share, download: Download, copy: Copy })
}
