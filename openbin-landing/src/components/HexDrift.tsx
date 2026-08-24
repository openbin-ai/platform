import { useEffect, useRef } from 'react'

// Byte-pair grid that slowly drifts upward like a scrolling hex dump, with
// occasional byte "flips" that flash in the accent color, and recognizable
// file-magic sequences (ELF, MZ, Mach-O, ZIP) seeded into fresh rows.
//
// Deliberately calm compared to the LetterGlitch it replaced: throttled to
// ~8fps, and fully static (single painted frame) on touch devices and under
// prefers-reduced-motion, so phones never pay for a decorative background.
//
// NOTE: this file is intentionally byte-identical in openbin-landing and
// openapk-frontend (same drift risk as the duplicated media components).
// Brand differences are passed in via props at the call site — keep it that
// way so the copies can be diffed.

type Props = {
  baseColors?: string[]
  accentColor?: string
  driftSpeed?: number // rows per second
  centerVignette?: boolean
  outerVignette?: boolean
}

type Cell = {
  text: string
  base: number // index into the per-base-color ramps
  flash: number // 0..FLASH_STEPS, decays one step per frame
}

const FONT_SIZE = 13
const CELL_W = 26
const CELL_H = 22
const FRAME_MS = 125
const FLASH_STEPS = 6
const FLIP_RATIO = 0.004
const MAGIC_ROW_CHANCE = 0.08

const MAGIC = [
  ['7f', '45', '4c', '46'], // ELF
  ['4d', '5a', '90', '00'], // PE (MZ)
  ['ca', 'fe', 'ba', 'be'], // Mach-O fat / Java class
  ['cf', 'fa', 'ed', 'fe'], // Mach-O 64
  ['50', '4b', '03', '04'], // ZIP / APK
]

const HEX = '0123456789abcdef'
const randomByte = () =>
  HEX[Math.floor(Math.random() * 16)] + HEX[Math.floor(Math.random() * 16)]

type Rgb = { r: number; g: number; b: number }

const hexToRgb = (hex: string): Rgb => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m
    ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
    : { r: 63, g: 63, b: 70 }
}

const mix = (a: Rgb, b: Rgb, t: number) =>
  `rgb(${Math.round(a.r + (b.r - a.r) * t)}, ${Math.round(a.g + (b.g - a.g) * t)}, ${Math.round(a.b + (b.b - a.b) * t)})`

export default function HexDrift({
  baseColors = ['#27272a', '#3f3f46', '#52525b'],
  accentColor = '#fbbf24',
  driftSpeed = 0.35,
  centerVignette = false,
  outerVignette = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Precompute a base→accent ramp per base color so per-cell color lookup
    // is an array index instead of string math on every draw.
    const accent = hexToRgb(accentColor)
    const ramps = baseColors.map(c => {
      const base = hexToRgb(c)
      return Array.from({ length: FLASH_STEPS + 1 }, (_, s) =>
        mix(base, accent, s / FLASH_STEPS),
      )
    })

    let columns = 0
    let rows: Cell[][] = []
    let offset = 0
    let raf: number | null = null
    let last = 0

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const coarsePointer = window.matchMedia('(hover: none)')
    const isStatic = () => reduceMotion.matches || coarsePointer.matches

    const newCell = (): Cell => ({
      text: randomByte(),
      base: Math.floor(Math.random() * ramps.length),
      flash: 0,
    })

    const newRow = (): Cell[] => {
      const row = Array.from({ length: columns }, newCell)
      if (columns > 6 && Math.random() < MAGIC_ROW_CHANCE) {
        const magic = MAGIC[Math.floor(Math.random() * MAGIC.length)]
        const at = Math.floor(Math.random() * (columns - magic.length))
        magic.forEach((byte, i) => {
          row[at + i] = { text: byte, base: ramps.length - 1, flash: 2 }
        })
      }
      return row
    }

    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect()
      ctx.clearRect(0, 0, width, height)
      ctx.font = `${FONT_SIZE}px ui-monospace, SFMono-Regular, Menlo, monospace`
      ctx.textBaseline = 'top'
      rows.forEach((row, r) => {
        const y = r * CELL_H - offset
        row.forEach((cell, c) => {
          ctx.fillStyle = ramps[cell.base][cell.flash]
          ctx.fillText(cell.text, c * CELL_W, y)
        })
      })
    }

    const step = () => {
      offset += driftSpeed * CELL_H * (FRAME_MS / 1000)
      while (offset >= CELL_H) {
        offset -= CELL_H
        rows.shift()
        rows.push(newRow())
      }
      const flips = Math.max(1, Math.floor(rows.length * columns * FLIP_RATIO))
      for (let i = 0; i < flips; i++) {
        const row = rows[Math.floor(Math.random() * rows.length)]
        const cell = row?.[Math.floor(Math.random() * columns)]
        if (!cell) continue
        cell.text = randomByte()
        cell.flash = FLASH_STEPS
      }
      rows.forEach(row =>
        row.forEach(cell => {
          if (cell.flash > 0) cell.flash--
        }),
      )
    }

    const animate = (now: number) => {
      if (now - last >= FRAME_MS) {
        last = now
        step()
        draw()
      }
      raf = requestAnimationFrame(animate)
    }

    const start = () => {
      if (raf !== null) cancelAnimationFrame(raf)
      raf = null
      if (!isStatic()) raf = requestAnimationFrame(animate)
    }

    const resize = () => {
      const parent = canvas.parentElement
      if (!parent) return
      const dpr = window.devicePixelRatio || 1
      const rect = parent.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      columns = Math.ceil(rect.width / CELL_W)
      rows = Array.from({ length: Math.ceil(rect.height / CELL_H) + 1 }, newRow)
      offset = 0
      draw()
    }

    resize()
    start()

    let resizeTimeout: ReturnType<typeof setTimeout> | undefined
    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        resize()
        start()
      }, 100)
    }
    window.addEventListener('resize', handleResize)
    reduceMotion.addEventListener('change', start)

    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
      if (resizeTimeout) clearTimeout(resizeTimeout)
      window.removeEventListener('resize', handleResize)
      reduceMotion.removeEventListener('change', start)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accentColor, driftSpeed, baseColors.join('|')])

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <canvas ref={canvasRef} className="block h-full w-full" />
      {outerVignette && (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,_rgba(0,0,0,0)_60%,_rgba(0,0,0,1)_100%)]" />
      )}
      {centerVignette && (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,_rgba(0,0,0,0.8)_0%,_rgba(0,0,0,0)_60%)]" />
      )}
    </div>
  )
}
