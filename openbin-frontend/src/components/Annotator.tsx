import { useEffect, useRef, useState } from 'react'

type Tool = 'rect' | 'arrow' | 'text' | 'free'
type Stroke =
  | { tool: 'rect'; color: string; x0: number; y0: number; x1: number; y1: number }
  | { tool: 'arrow'; color: string; x0: number; y0: number; x1: number; y1: number }
  | { tool: 'text'; color: string; x: number; y: number; text: string }
  | { tool: 'free'; color: string; points: { x: number; y: number }[] }

const COLORS = ['#ef4444', '#f59e0b', '#22d3ee', '#a78bfa', '#000000']

/**
 * Two-stage editor:
 *  1. (optional) crop — drag a rectangle on the image to select a region
 *  2. annotate — draw with rect/arrow/text/free tools
 */
export function Annotator({
  src, cropFirst, onSave, onCancel, saving,
}: {
  src: string
  cropFirst?: boolean
  onSave: (blob: Blob) => void
  onCancel: () => void
  saving: boolean
}) {
  const [workingSrc, setWorkingSrc] = useState(src)
  const [stage, setStage] = useState<'crop' | 'annotate'>(cropFirst ? 'crop' : 'annotate')

  if (stage === 'crop') {
    return (
      <Cropper
        src={src}
        onCancel={onCancel}
        onSkip={() => setStage('annotate')}
        onConfirm={url => { setWorkingSrc(url); setStage('annotate') }}
      />
    )
  }
  return (
    <AnnotateCanvas
      src={workingSrc}
      onSave={onSave}
      onCancel={onCancel}
      saving={saving}
    />
  )
}

function AnnotateCanvas({
  src, onSave, onCancel, saving,
}: {
  src: string
  onSave: (blob: Blob) => void
  onCancel: () => void
  saving: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<Tool>('rect')
  const [color, setColor] = useState<string>(COLORS[0])
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [drafting, setDrafting] = useState<Stroke | null>(null)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)

  // Load image once
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imgRef.current = img
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
    }
    img.src = src
    return () => { imgRef.current = null }
  }, [src])

  // Redraw whenever strokes or draft change
  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !imgSize) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = imgSize.w
    canvas.height = imgSize.h
    ctx.drawImage(img, 0, 0)
    const all = drafting ? [...strokes, drafting] : strokes
    for (const s of all) drawStroke(ctx, s)
  }, [strokes, drafting, imgSize])

  // Undo with Ctrl/Cmd+Z
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        setStrokes(s => s.slice(0, -1))
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  function canvasCoords(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (saving) return
    const { x, y } = canvasCoords(e)
    if (tool === 'text') {
      const text = window.prompt('Text:')
      if (text && text.trim()) {
        setStrokes(s => [...s, { tool: 'text', color, x, y, text: text.trim() }])
      }
      return
    }
    if (tool === 'free') {
      setDrafting({ tool: 'free', color, points: [{ x, y }] })
      return
    }
    setDrafting({ tool, color, x0: x, y0: y, x1: x, y1: y })
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drafting) return
    const { x, y } = canvasCoords(e)
    if (drafting.tool === 'free') {
      setDrafting({ ...drafting, points: [...drafting.points, { x, y }] })
    } else if (drafting.tool === 'rect' || drafting.tool === 'arrow') {
      setDrafting({ ...drafting, x1: x, y1: y })
    }
  }

  function onMouseUp() {
    if (!drafting) return
    // discard zero-size shapes
    if ((drafting.tool === 'rect' || drafting.tool === 'arrow') &&
        Math.abs(drafting.x1 - drafting.x0) < 3 &&
        Math.abs(drafting.y1 - drafting.y0) < 3) {
      setDrafting(null)
      return
    }
    setStrokes(s => [...s, drafting])
    setDrafting(null)
  }

  function save() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob(b => { if (b) onSave(b) }, 'image/png')
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-950/80 p-2">
        <ToolBtn active={tool === 'rect'}  onClick={() => setTool('rect')}>▭ Rect</ToolBtn>
        <ToolBtn active={tool === 'arrow'} onClick={() => setTool('arrow')}>↗ Arrow</ToolBtn>
        <ToolBtn active={tool === 'text'}  onClick={() => setTool('text')}>T Text</ToolBtn>
        <ToolBtn active={tool === 'free'}  onClick={() => setTool('free')}>✎ Free</ToolBtn>
        <div className="mx-2 h-5 w-px bg-zinc-800" />
        {COLORS.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-zinc-100' : 'border-zinc-700'}`}
            style={{ background: c }}
            title={c}
          />
        ))}
        <div className="mx-2 h-5 w-px bg-zinc-800" />
        <button
          onClick={() => setStrokes(s => s.slice(0, -1))}
          disabled={strokes.length === 0}
          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
        >
          Undo
        </button>
        <button
          onClick={() => setStrokes([])}
          disabled={strokes.length === 0}
          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
        >
          Clear
        </button>
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving || !imgSize}
          className="rounded bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
        >
          {saving ? 'Uploading…' : 'Save & Insert'}
        </button>
      </div>

      {/* Canvas */}
      <div className="flex flex-1 items-center justify-center overflow-auto bg-zinc-950 p-4">
        {imgSize ? (
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            className="max-h-full max-w-full cursor-crosshair border border-zinc-800 shadow-lg"
          />
        ) : (
          <p className="text-sm text-zinc-500">Loading image…</p>
        )}
      </div>
    </div>
  )
}

function ToolBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-1 text-xs ${
        active ? 'bg-purple-600 text-white' : 'border border-zinc-700 text-zinc-200 hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  )
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color

  if (s.tool === 'rect') {
    ctx.beginPath()
    ctx.rect(
      Math.min(s.x0, s.x1), Math.min(s.y0, s.y1),
      Math.abs(s.x1 - s.x0), Math.abs(s.y1 - s.y0),
    )
    ctx.stroke()
  } else if (s.tool === 'arrow') {
    const headLen = 14
    const dx = s.x1 - s.x0
    const dy = s.y1 - s.y0
    const angle = Math.atan2(dy, dx)
    ctx.beginPath()
    ctx.moveTo(s.x0, s.y0)
    ctx.lineTo(s.x1, s.y1)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(s.x1, s.y1)
    ctx.lineTo(s.x1 - headLen * Math.cos(angle - Math.PI / 6), s.y1 - headLen * Math.sin(angle - Math.PI / 6))
    ctx.lineTo(s.x1 - headLen * Math.cos(angle + Math.PI / 6), s.y1 - headLen * Math.sin(angle + Math.PI / 6))
    ctx.closePath()
    ctx.fill()
  } else if (s.tool === 'text') {
    ctx.font = '20px sans-serif'
    ctx.textBaseline = 'top'
    // background pill for readability
    const metrics = ctx.measureText(s.text)
    const pad = 4
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(s.x - pad, s.y - pad, metrics.width + pad * 2, 24 + pad * 2)
    ctx.fillStyle = s.color
    ctx.fillText(s.text, s.x, s.y)
  } else if (s.tool === 'free') {
    if (s.points.length < 2) return
    ctx.beginPath()
    ctx.moveTo(s.points[0].x, s.points[0].y)
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
    ctx.stroke()
  }
}

// =========================================================================
// Cropper — drag a rectangle on the image to pick a region
// =========================================================================

type Rect = { x: number; y: number; w: number; h: number }

function Cropper({
  src, onConfirm, onSkip, onCancel,
}: {
  src: string
  onConfirm: (croppedUrl: string) => void
  onSkip: () => void
  onCancel: () => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [imgReady, setImgReady] = useState(false)

  function clientToImage(e: React.MouseEvent) {
    const img = imgRef.current
    if (!img) return { x: 0, y: 0 }
    const bounds = img.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(bounds.width,  e.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, e.clientY - bounds.top)),
    }
  }

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    const p = clientToImage(e)
    setDragStart(p)
    setRect({ x: p.x, y: p.y, w: 0, h: 0 })
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragStart) return
    const p = clientToImage(e)
    setRect({
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      w: Math.abs(p.x - dragStart.x),
      h: Math.abs(p.y - dragStart.y),
    })
  }
  function onMouseUp() {
    setDragStart(null)
    if (rect && (rect.w < 4 || rect.h < 4)) setRect(null)
  }

  function confirm() {
    const img = imgRef.current
    if (!img || !rect) return
    // Map display-space rect to natural-image coords
    const scaleX = img.naturalWidth / img.clientWidth
    const scaleY = img.naturalHeight / img.clientHeight
    const sx = Math.round(rect.x * scaleX)
    const sy = Math.round(rect.y * scaleY)
    const sw = Math.round(rect.w * scaleX)
    const sh = Math.round(rect.h * scaleY)
    if (sw <= 0 || sh <= 0) return

    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
    canvas.toBlob(blob => {
      if (blob) onConfirm(URL.createObjectURL(blob))
    }, 'image/png')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-950/80 p-2">
        <span className="text-xs text-zinc-300">
          {rect ? `Selected ${Math.round(rect.w)}×${Math.round(rect.h)} — drag again to redo` : 'Drag on the image to select a region'}
        </span>
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          onClick={onSkip}
          className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
        >
          Use full image
        </button>
        <button
          onClick={confirm}
          disabled={!rect}
          className="rounded bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-40"
        >
          Confirm crop
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto bg-black p-4">
        <div
          className="relative inline-block select-none"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <img
            ref={imgRef}
            src={src}
            draggable={false}
            onLoad={() => setImgReady(true)}
            className="block max-h-[70vh] max-w-full cursor-crosshair"
          />
          {imgReady && rect && (
            <>
              <div className="pointer-events-none absolute bg-black/55"
                   style={{ left: 0, top: 0, width: '100%', height: rect.y }} />
              <div className="pointer-events-none absolute bg-black/55"
                   style={{ left: 0, top: rect.y + rect.h, width: '100%', bottom: 0 }} />
              <div className="pointer-events-none absolute bg-black/55"
                   style={{ left: 0, top: rect.y, width: rect.x, height: rect.h }} />
              <div className="pointer-events-none absolute bg-black/55"
                   style={{ left: rect.x + rect.w, top: rect.y, right: 0, height: rect.h }} />
              <div className="pointer-events-none absolute border-2 border-purple-400"
                   style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
