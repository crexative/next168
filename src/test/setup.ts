// Node 22.4+ defines an experimental global `localStorage` that is undefined unless
// `--localstorage-file` is set, and it hides the DOM environment's storage. Tests get an
// in-memory Storage in that case so they behave the same on every supported Node version.
class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>()
  get length(): number { return this.items.size }
  clear(): void { this.items.clear() }
  getItem(key: string): string | null { return this.items.get(key) ?? null }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null }
  removeItem(key: string): void { this.items.delete(key) }
  setItem(key: string, value: string): void { this.items.set(key, String(value)) }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (typeof globalThis[name]?.clear !== 'function') {
    Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true, writable: true })
  }
}
