import { describe, expect, test } from 'claude-code/testing'

import { graded, overlay, paintRects, partMarkup, rgbOf, scale } from './clawd-vector'
import type { Shape } from './clawd-vector'
import { smoothPixels, smoothSvg } from './scene-smooth'
import { STAY_MS, litLights, sceneryOf } from './scenery'
import type { Scenery } from './scenery'
import { STOPS } from './scenery-stops'

// The world tour behind the smooth scene (hooks/scenery.ts): where it is at
// any moment, the stop's name and hour as it arrives, the pan to the next,
// each stop's time of day, its weather, and its room in the desktop's drawing.

const LEG_MS = STAY_MS + 7000
/** The start of a round of the tour: it has just come to its first stop. */
const ROUND = Math.ceil(1_700_000_000_000 / LEG_MS / STOPS.length) * STOPS.length * LEG_MS

const sceneryAt = (now: number, daylight: 'fast' | 'real' = 'fast', width = 240): Scenery => sceneryOf(width, 24, 20, now, daylight)
const captionOf = (now: number, width = 240, daylight: 'fast' | 'real' = 'fast'): string | undefined => sceneryAt(now, daylight, width).land.moving.find(shape => shape.kind === 'text')?.text

/** A time the tour stays at the stop named, `into` its stay, the hour there within a quarter of `hour`: by its sun (`real`), or the world day of 24 minutes. */
const visit = (name: string, hour: number, into = 20_000, daylight: 'fast' | 'real' = 'real'): number => {
  const index = STOPS.findIndex(stop => stop.name === name)
  const lon = STOPS[index]?.lon ?? 0
  for (let round = 0; round < 10_000; round += 1) {
    const now = ROUND + (round * STOPS.length + index) * LEG_MS + into
    const off = (((now / (daylight === 'real' ? 3_600_000 : 60_000) + lon / 15 - hour) % 24) + 24) % 24
    if (Math.min(off, 24 - off) < 0.25) return now
  }
  throw new Error(`never at ${name} at ${hour}`)
}

const brightness = (hex: string): number => rgbOf(hex).reduce((sum, v) => sum + v, 0) / 3
/** The view's own stop's sky (the rect over its middle), from the top down. */
const skyOf = (scenery: Scenery): string[] => scenery.sky.fill.find(shape => shape.fade === undefined && shape.x <= 120 && shape.x + shape.w > 120)?.grad?.stops.map(([, colour]) => colour) ?? []

describe('the tour', () => {
  test('a function of the time alone: the band and a pane of another size are at the same stop, at the same hour', () => {
    expect(JSON.stringify(sceneryAt(ROUND + 3000))).toBe(JSON.stringify(sceneryAt(ROUND + 3000)))
    expect(captionOf(ROUND + 3000)).toBe(captionOf(ROUND + 3000, 150))
    expect(captionOf(ROUND + 3000)).toMatch(/^[A-Z ]+ · [A-Z ]+ · \d\d:\d\d$/)
  })

  test('the stop\'s name and hour fade in after it arrives and out ten seconds on; each stop its own, round the world eastward', () => {
    expect(captionOf(ROUND + 100)).toBeUndefined()
    expect(captionOf(ROUND + 5000)).toBeDefined()
    expect(captionOf(ROUND + 20_000)).toBeUndefined()
    const names = STOPS.map((_, leg) => captionOf(ROUND + leg * LEG_MS + 5000)?.replace(/ · \d\d:\d\d$/, ''))
    expect(names).toEqual(STOPS.map(stop => stop.name))
    expect(STOPS.every((stop, index) => index === 0 || stop.lon > (STOPS[index - 1]?.lon ?? -180))).toBe(true)
  })

  test('it stays, then pans on to the next stop: the leg\'s strip kept, seen from further along each frame', () => {
    const stay = sceneryAt(ROUND + 10_000).land
    expect([stay.shift, stay.span]).toEqual([0, 240])
    // Through the pan's seven seconds, to the last millisecond before the next stay.
    const shifts = Array.from({ length: 8 }, (_, step) => sceneryAt(ROUND + STAY_MS + 1 + step * 999.8).land)
    expect(new Set(shifts.map(one => one.key)).size).toBe(1)
    for (let step = 1; step < shifts.length; step += 1) expect(shifts[step]!.shift).toBeGreaterThan(shifts[step - 1]!.shift)
    expect(Math.abs(shifts[shifts.length - 1]!.shift - (shifts[0]!.span - 240))).toBeLessThan(0.1)
    // No name while it pans.
    expect(shifts.every(one => !one.moving.some(shape => shape.kind === 'text'))).toBe(true)
  })
})

describe('its days', () => {
  test('each stop at its own hour, Greenwich\'s and its longitude over 15: by default a world day in 24 minutes, or the real one', () => {
    const minutes = (caption: string | undefined): number => {
      const [, hours = '0', mins = '0'] = /(\d\d):(\d\d)$/.exec(caption ?? '') ?? []

      return Number(hours) * 60 + Number(mins)
    }
    // Fast: six seconds are six minutes there.
    expect((minutes(captionOf(ROUND + 8000)) - minutes(captionOf(ROUND + 2000)) + 1440) % 1440).toBe(6)
    // Real: the hour by its sun now.
    const now = visit('PARIS · FRANCE', 15, 5000)
    const hour = (((now / 3_600_000 + (STOPS.find(stop => stop.name === 'PARIS · FRANCE')?.lon ?? 0) / 15) % 24) + 24) % 24
    expect(captionOf(now, 240, 'real')).toBe(`PARIS · FRANCE · ${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`)
    expect(captionOf(now + 4000, 240, 'real')).toBe(captionOf(now, 240, 'real'))
  })

  test('by day a clear stop is as drawn, its lights out, its sky bright, the sun up; by night its land dim and blue, its lights on, its sky dark with stars', () => {
    const day = sceneryAt(visit('ROME · ITALY', 12.5), 'real')
    expect(day.land.litAt(120)).toEqual({ glow: 0 })
    expect(litLights(day.land)).toEqual([])
    expect(brightness(skyOf(day).at(-1) ?? '')).toBeGreaterThan(180)
    expect(day.sky.moving.some(shape => shape.kind === 'ellipse' && shape.fill.startsWith('#fff') && (shape.alpha ?? 1) === 1)).toBe(true)
    expect(day.sky.moving.filter(shape => shape.fill === '#f4f0ff')).toEqual([])

    const night = sceneryAt(visit('ROME · ITALY', 0.5), 'real')
    const { grade, glow } = night.land.litAt(120)
    expect(glow).toBeGreaterThan(0.95)
    // Dimmer, and bluer than red.
    expect(grade?.m[0][0] ?? 1).toBeLessThan(0.3)
    expect(grade?.m[2][2] ?? 0).toBeGreaterThan(grade?.m[0][0] ?? 1)
    expect(litLights(night.land).length).toBeGreaterThan(10)
    expect(brightness(skyOf(night).at(-1) ?? '#ffffff')).toBeLessThan(70)
    expect(night.sky.moving.filter(shape => shape.fill === '#f4f0ff').length).toBeGreaterThan(5)
  })

  test('the low sun gilds the land and reddens the sky; the lights come on at dusk; grey weather greys it all day', () => {
    const evening = sceneryAt(visit('ROME · ITALY', 17.6), 'real')
    const gold = evening.land.litAt(120).grade
    expect(gold?.m[0][0] ?? 0).toBeGreaterThan(gold?.m[2][2] ?? 1)
    const [red = 0, , blue = 255] = rgbOf(skyOf(evening).at(-1) ?? '#000000')
    expect(red).toBeGreaterThan(blue)
    expect(evening.land.litAt(120).glow).toBe(0)
    expect(sceneryAt(visit('ROME · ITALY', 19), 'real').land.litAt(120).glow).toBeGreaterThan(0.3)
    // London under its clouds at noon: greyer than drawn, its sky greyer than Rome's.
    const london = sceneryAt(visit('LONDON · UK', 12.5), 'real')
    expect(london.land.litAt(120).grade).toBeDefined()
    const spread = (scenery: Scenery): number => {
      const rgb = rgbOf(skyOf(scenery)[1] ?? '#000000')

      return Math.max(...rgb) - Math.min(...rgb)
    }
    expect(spread(london) * 2).toBeLessThan(spread(sceneryAt(visit('ROME · ITALY', 12.5), 'real')))
  })

  test('neighbours\' skies meet smoothly: the next one faded in over the seam, the top of all of it faded in from the page', () => {
    const scenery = sceneryAt(ROUND + 10_000)
    const seams = scenery.sky.fill.filter(shape => shape.fade !== undefined)
    expect(seams.length).toBeGreaterThan(0)
    for (const seam of seams) expect(seam.fade).toEqual([seam.x, seam.x + seam.w])
    expect(scenery.sky.top).toBeGreaterThan(0)
    const svg = smoothSvg({ shapes: [], wholes: [], width: 240, height: 24, still: false, scenery }, 120, 6, 90_000).source
    expect(svg).toContain(`<g mask='url(#sky)'>`)
    expect((svg.match(/<mask /g) ?? []).length).toBe(seams.length + 1)
  })
})

describe('its weather', () => {
  test('rain in London, leaves in Paris, cherry blossom at Fuji, snow in Tromsø; motes in front of the mascots too', () => {
    const motes = (scenery: Scenery): Shape[] => [...scenery.land.moving, ...scenery.front]
    expect(motes(sceneryAt(visit('LONDON · UK', 12.5), 'real')).filter(shape => shape.kind === 'line' && (shape.stroke ?? 1) < 0.3).length).toBeGreaterThan(5)
    expect(motes(sceneryAt(visit('PARIS · FRANCE', 12.5), 'real')).some(shape => ['#e2762c', '#c8452e', '#f0b040', '#b85a26'].includes(shape.fill))).toBe(true)
    expect(motes(sceneryAt(visit('MT FUJI · JAPAN', 12.5), 'real')).some(shape => shape.fill === '#f8bcd4')).toBe(true)
    const tromso = sceneryAt(visit('TROMSO · NORWAY', 12.5), 'real')
    expect(motes(tromso).some(shape => shape.fill === '#ffffff')).toBe(true)
    expect(tromso.front.length).toBeGreaterThan(0)
  })

  test('fireflies over Agra by night alone; snow by night as dim as the land', () => {
    const fireflies = (scenery: Scenery): number => scenery.land.moving.filter(shape => shape.fill === '#fffbd0').length
    expect(fireflies(sceneryAt(visit('AGRA · INDIA', 12.5), 'real'))).toBe(0)
    expect(fireflies(sceneryAt(visit('AGRA · INDIA', 22), 'real'))).toBeGreaterThan(0)
    const snow = sceneryAt(visit('TROMSO · NORWAY', 0.5), 'real').front.filter(shape => shape.kind === 'ellipse')
    expect(snow.length).toBeGreaterThan(0)
    expect(snow.every(shape => brightness(shape.fill) < 120)).toBe(true)
  })
})

describe('drawn', () => {
  test('a grade: each channel a row times the colour, plus its add; laid over pixels column by column, its alpha scaled', () => {
    const dim = { m: [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 1]], add: [0, 0, 20] } as const
    expect(graded('#80a0ff', dim)).toBe('#4050ff')
    const below = new Uint8Array(2 * 4)
    overlay(below, new Uint8Array([128, 160, 200, 255, 128, 160, 200, 255]), 2, 2, 0, [dim, { ...dim, alpha: 0.5 }])
    expect([...below]).toEqual([64, 80, 220, 255, 64, 80, 220, 128])
  })

  test('rects of a sky painted whole pixels at a time, a gradient down each; one fading in laid over what is there', () => {
    const pixels = new Uint8Array(4 * 2 * 4)
    const base: Shape = { kind: 'rect', x: 0, y: 0, w: 4, h: 2, fill: '#000000', grad: { x1: 0, y1: 0, x2: 0, y2: 2, stops: [[0, '#000000', 1], [1, '#ffffff', 1]] } }
    paintRects(pixels, 4, 2, scale(1), [base, { kind: 'rect', x: 0, y: 0, w: 4, h: 2, fill: '#ff0000', fade: [0, 4] }])
    // Down the first column, darker then lighter; across the rows, redder as it fades in.
    expect(pixels[0]).toBeLessThan(pixels[16] ?? 0)
    expect(pixels[12] ?? 0).toBeGreaterThan(pixels[0] ?? 0)
    expect(pixels[13] ?? 255).toBeLessThan(pixels[1] ?? 0)
    expect(pixels[3]).toBe(255)
    // On the desktop, a mask of a ramp.
    expect(partMarkup([{ kind: 'rect', x: 0, y: 0, w: 4, h: 2, fill: '#ff0000', fade: [0, 4] }]).markup).toMatch(/<mask id='g2'>.*<rect [^>]*mask='url\(#g2\)'\/>$/)
  })

  test('in a terminal\'s picture as on the desktop: the land dim and blue by night', () => {
    const at = (scenery: Scenery): number[] => {
      const { pixels, width } = smoothPixels({ shapes: [], wholes: [], width: 240, height: 24, still: false, scenery }, 120, 6, { width: 8, height: 16 })
      // The ground under the stop's middle, a row up from the bottom.
      const p = ((96 - 8) * width + 480) * 4

      return [pixels[p] ?? 0, pixels[p + 1] ?? 0, pixels[p + 2] ?? 0]
    }
    const [dayRed = 0] = at(sceneryAt(visit('ROME · ITALY', 12.5), 'real'))
    const [nightRed = 255, , nightBlue = 0] = at(sceneryAt(visit('ROME · ITALY', 0.5), 'real'))
    expect(nightRed).toBeLessThan(dayRed / 2)
    expect(nightBlue).toBeGreaterThan(nightRed)
  })
})

describe('on the desktop', () => {
  test('the scenery takes what room the mascots leave: never a mascot for it; short of room, the ground\'s texture goes first, then all of it', () => {
    const scenery = sceneryAt(ROUND + 20_000)
    const mascot = (size: number): Shape[] => Array.from({ length: size }, (_, index) => ({ kind: 'ellipse', x: index % 200, y: 10, w: 1.3, h: 1.1, fill: '#D77757' }))
    const svg = (shapes: Shape[]) => smoothSvg({ shapes, wholes: [[0, shapes.length]], width: 240, height: 24, still: false, scenery }, 120, 6, 90_000).source
    const roomy = svg(mascot(10))
    expect(roomy).toContain('linearGradient')
    // A crowd that leaves little room: every mascot drawn, the scenery thinner or gone.
    const crowd = svg(mascot(900))
    expect((crowd.match(/fill='#D77757'/g) ?? []).length).toBe(900)
    expect(crowd.length).toBeLessThan(90_000)
    expect(crowd.length).toBeLessThan(roomy.length + 900 * 90)
  })

  test('the still land lit for the hour, made again only as the light changes: through dusk in steps, all day and all night never', () => {
    const keyAt = (now: number): string => sceneryAt(now).land.litKey
    const dusk = visit('ROME · ITALY', 18, 2000, 'fast')
    expect(keyAt(dusk + 33)).toBe(keyAt(dusk))
    expect(keyAt(dusk + 30_000)).not.toBe(keyAt(dusk))
    for (const hour of [11.5, 23.5]) expect(keyAt(visit('ROME · ITALY', hour, 2000, 'fast') + 40_000)).toBe(keyAt(visit('ROME · ITALY', hour, 2000, 'fast')))
  })
})
