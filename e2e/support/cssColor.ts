const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i
const HUE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:deg|grad|rad|turn)?$/i

function fraction(value: string): number {
  if (!NUMBER.test(value)) throw new Error(`Unrecognized CSS color fraction: ${value}`)
  const number = Number.parseFloat(value) / (value.endsWith('%') ? 100 : 1)
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`Invalid CSS color fraction: ${value}`)
  return number
}

function splitColors(value: string): string[] {
  const parts: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++
    if (value[i] === ')') depth--
    if (depth < 0) throw new Error(`Invalid CSS color: ${value}`)
    if (value[i] === ',' && depth === 0) { parts.push(value.slice(start, i).trim()); start = i + 1 }
  }
  if (depth !== 0) throw new Error(`Invalid CSS color: ${value}`)
  return [...parts, value.slice(start).trim()]
}

/** Alpha of computed CSS colors, including browsers that retain color-mix(). Unknown syntax fails closed. */
export function cssColorAlpha(value: string): number {
  return parseAlpha(value.trim().toLowerCase(), 0)
}

function parseAlpha(color: string, depth: number): number {
  if (depth > 10) throw new Error('CSS color nesting limit exceeded')
  if (color === 'transparent') return 0
  if (color === 'white' || color === 'black') return 1
  if (/^#(?:[\da-f]{3}|[\da-f]{6})$/.test(color)) return 1
  if (/^#[\da-f]{4}$/.test(color)) return Number.parseInt(color[4]!.repeat(2), 16) / 255
  if (/^#[\da-f]{8}$/.test(color)) return Number.parseInt(color.slice(7), 16) / 255

  const mix = /^color-mix\(in (?:srgb|srgb-linear|display-p3|oklab|lab|xyz|xyz-d50|xyz-d65),\s*(.*)\)$/.exec(color)
  if (mix) {
    const parts = splitColors(mix[1]!)
    if (parts.length !== 2) throw new Error(`Invalid CSS color mix: ${color}`)
    const stops = parts.map((part) => {
      const match = /^(.*?)(?:\s+([\d.]+%))?$/.exec(part)!
      return { alpha: parseAlpha(match[1]!.trim(), depth + 1), weight: match[2] === undefined ? undefined : fraction(match[2]) }
    })
    const first = stops[0]!, second = stops[1]!
    const a = first.weight ?? (second.weight === undefined ? 0.5 : 1 - second.weight)
    const b = second.weight ?? 1 - a
    const sum = a + b
    if (sum === 0) throw new Error(`Invalid CSS color mix: ${color}`)
    // CSS normalizes the weights, then scales alpha when their sum is below 100%.
    return ((first.alpha * a + second.alpha * b) / sum) * Math.min(sum, 1)
  }

  const fn = /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\((.*)\)$/.exec(color)
  if (fn) {
    const name = fn[1]!
    let body = fn[2]!.trim()
    if (name === 'color') {
      const space = /^(?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65)\s+/.exec(body)
      if (!space) throw new Error(`Unrecognized CSS color space: ${color}`)
      body = body.slice(space[0].length)
    }
    const legacy = body.includes(',')
    const parts = legacy ? body.split(',').map((part) => part.trim()) : body.split('/').map((part) => part.trim())
    const channels = legacy ? parts.slice(0, 3) : parts[0]!.split(/\s+/)
    const alpha = legacy ? parts[3] : parts[1]
    const validChannels = channels.length === 3 && channels.every((part, index) => NUMBER.test(part) || (index === 0 && /^(?:hsl|hsla|hwb)$/.test(name) && HUE.test(part)))
    if (validChannels && (legacy ? /^(?:rgb|rgba|hsl|hsla)$/.test(name) && (parts.length === 3 || parts.length === 4) : parts.length <= 2)) return alpha === undefined ? 1 : fraction(alpha)
  }
  throw new Error(`Unrecognized CSS color: ${color}`)
}
