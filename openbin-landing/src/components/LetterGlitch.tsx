import { useEffect, useRef } from 'react'

type Letter = {
  char: string
  color: string
  targetColor: string
  colorProgress: number
}

type Props = {
  glitchColors?: string[]
  glitchSpeed?: number
  centerVignette?: boolean
  outerVignette?: boolean
  smooth?: boolean
  characters?: string
}

const FONT_SIZE = 16
const CHAR_WIDTH = 10
const CHAR_HEIGHT = 20

export default function LetterGlitch({
  glitchColors = ['#fbbf24', '#71717a', '#3f3f46'],
  glitchSpeed = 55,
  centerVignette = false,
  outerVignette = true,
  smooth = true,
  characters = '01ABCDEFabcdef!@#$&*()-_+=/[]{};:<>.,',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationRef = useRef<number | null>(null)
  const letters = useRef<Letter[]>([])
  const grid = useRef<{ columns: number; rows: number }>({ columns: 0, rows: 0 })
  const context = useRef<CanvasRenderingContext2D | null>(null)
  const lastGlitchTime = useRef<number>(Date.now())

  const lettersAndSymbols = Array.from(characters)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    context.current = canvas.getContext('2d')

    const getRandomChar = () =>
      lettersAndSymbols[Math.floor(Math.random() * lettersAndSymbols.length)]

    const getRandomColor = () =>
      glitchColors[Math.floor(Math.random() * glitchColors.length)]

    const hexToRgb = (hex: string) => {
      const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i
      const expanded = hex.replace(shorthandRegex, (_m, r, g, b) => r + r + g + g + b + b)
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded)
      return result
        ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
        : null
    }

    const interpolateColor = (
      start: { r: number; g: number; b: number },
      end: { r: number; g: number; b: number },
      factor: number,
    ) => {
      const r = Math.round(start.r + (end.r - start.r) * factor)
      const g = Math.round(start.g + (end.g - start.g) * factor)
      const b = Math.round(start.b + (end.b - start.b) * factor)
      return `rgb(${r}, ${g}, ${b})`
    }

    const calculateGrid = (width: number, height: number) => ({
      columns: Math.ceil(width / CHAR_WIDTH),
      rows: Math.ceil(height / CHAR_HEIGHT),
    })

    const initializeLetters = (columns: number, rows: number) => {
      grid.current = { columns, rows }
      const total = columns * rows
      letters.current = Array.from({ length: total }, () => ({
        char: getRandomChar(),
        color: getRandomColor(),
        targetColor: getRandomColor(),
        colorProgress: 1,
      }))
    }

    const drawLetters = () => {
      const ctx = context.current
      const c = canvasRef.current
      if (!ctx || !c || letters.current.length === 0) return
      const { width, height } = c.getBoundingClientRect()
      ctx.clearRect(0, 0, width, height)
      ctx.font = `${FONT_SIZE}px monospace`
      ctx.textBaseline = 'top'
      letters.current.forEach((letter, index) => {
        const x = (index % grid.current.columns) * CHAR_WIDTH
        const y = Math.floor(index / grid.current.columns) * CHAR_HEIGHT
        ctx.fillStyle = letter.color
        ctx.fillText(letter.char, x, y)
      })
    }

    const resizeCanvas = () => {
      const c = canvasRef.current
      if (!c) return
      const parent = c.parentElement
      if (!parent) return
      const dpr = window.devicePixelRatio || 1
      const rect = parent.getBoundingClientRect()
      c.width = rect.width * dpr
      c.height = rect.height * dpr
      c.style.width = `${rect.width}px`
      c.style.height = `${rect.height}px`
      if (context.current) {
        context.current.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      const { columns, rows } = calculateGrid(rect.width, rect.height)
      initializeLetters(columns, rows)
      drawLetters()
    }

    const updateLetters = () => {
      if (letters.current.length === 0) return
      const updateCount = Math.max(1, Math.floor(letters.current.length * 0.05))
      for (let i = 0; i < updateCount; i++) {
        const index = Math.floor(Math.random() * letters.current.length)
        const letter = letters.current[index]
        if (!letter) continue
        letter.char = getRandomChar()
        letter.targetColor = getRandomColor()
        if (!smooth) {
          letter.color = letter.targetColor
          letter.colorProgress = 1
        } else {
          letter.colorProgress = 0
        }
      }
    }

    const handleSmoothTransitions = () => {
      let needsRedraw = false
      letters.current.forEach(letter => {
        if (letter.colorProgress < 1) {
          letter.colorProgress += 0.05
          if (letter.colorProgress > 1) letter.colorProgress = 1
          const startRgb = hexToRgb(letter.color)
          const endRgb = hexToRgb(letter.targetColor)
          if (startRgb && endRgb) {
            letter.color = interpolateColor(startRgb, endRgb, letter.colorProgress)
            needsRedraw = true
          }
        }
      })
      if (needsRedraw) drawLetters()
    }

    const animate = () => {
      const now = Date.now()
      if (now - lastGlitchTime.current >= glitchSpeed) {
        updateLetters()
        drawLetters()
        lastGlitchTime.current = now
      }
      if (smooth) handleSmoothTransitions()
      animationRef.current = requestAnimationFrame(animate)
    }

    resizeCanvas()
    animate()

    let resizeTimeout: ReturnType<typeof setTimeout> | undefined
    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
        resizeCanvas()
        animate()
      }, 100)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
      window.removeEventListener('resize', handleResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glitchSpeed, smooth])

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
