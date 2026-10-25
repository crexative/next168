// WCAG relative luminance and contrast for the colours the app draws itself (token hex and hsl values, custom
// category hex). The contrast specs and the share card use the same helper.
export type Rgb = [number, number, number]

export function rgb(value: string): Rgb {
  if (/^#[\da-f]{6}$/i.test(value)) {
    return [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255) as Rgb
  }
  const hsl = value.match(/^hsl\(([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)$/)
  if (!hsl) throw new Error(`Unsupported token color: ${value}`)
  const hue = Number(hsl[1]) / 30
  const saturation = Number(hsl[2]) / 100
  const lightness = Number(hsl[3]) / 100
  const amplitude = saturation * Math.min(lightness, 1 - lightness)
  return [0, 8, 4].map((offset) => {
    const channel = (offset + hue) % 12
    return lightness - amplitude * Math.max(-1, Math.min(channel - 3, 9 - channel, 1))
  }) as Rgb
}

function luminance(color: Rgb): number {
  const linear = color.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4)
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
}

export function contrast(foreground: Rgb, background: Rgb): number {
  const values = [luminance(foreground), luminance(background)]
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
}
