import { i18n } from '@/i18n'
import { validatePublicUrl } from '../../config/publicUrl'

// The product's name and public address, in one place, so renaming the product changes one catalog key (app.name).
// The public address comes only from a validated VITE_PUBLIC_URL; the app never uses location.origin, which can be a
// LAN address or localhost.
export interface Brand {
  readonly name: string
  readonly slug: string
  readonly publicUrl?: string
}

export function publicUrlFrom(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const result = validatePublicUrl(raw)
  return result.ok ? result.url : undefined
}

const publicUrl = publicUrlFrom(import.meta.env.VITE_PUBLIC_URL)

export const BRAND: Brand = {
  get name() { return i18n.global.t('app.name') },
  slug: 'next168',
  ...(publicUrl ? { publicUrl } : {}),
}
