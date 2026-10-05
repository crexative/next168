import { vi } from 'vitest'
import { Window } from 'happy-dom'
// Use the DOM implementation when Node's experimental storage shadows global properties.
const storageWindow = new Window({ url: 'http://localhost' })
vi.stubGlobal('localStorage', storageWindow.localStorage)
vi.stubGlobal('Storage', storageWindow.Storage)
