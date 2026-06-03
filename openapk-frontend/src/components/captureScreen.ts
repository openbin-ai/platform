/**
 * Calls the browser's screen picker, then captures a single frame.
 *
 * To keep our own UI out of the shot when the user picks our tab, any element
 * marked with `data-capture-hide` is hidden between picker-close and frame-grab,
 * then restored. The browser's screen-picker dialog itself is rendered by the
 * OS/browser and is not affected.
 *
 * Returns null if the user cancels the picker. Throws on any other error.
 */
export async function captureScreen(): Promise<Blob | null> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' } as MediaTrackConstraints,
      audio: false,
    })
  } catch (e) {
    const msg = (e as Error).message.toLowerCase()
    // User cancelled / dismissed picker — silent
    if (msg.includes('not allowed') || msg.includes('permission denied') || msg.includes('aborted')) {
      return null
    }
    throw e
  }

  // Hide UI we don't want in the shot, then give the browser a beat to repaint
  // before drawing a frame.
  const hidden = Array.from(document.querySelectorAll<HTMLElement>('[data-capture-hide]'))
  const prev = hidden.map(el => el.style.visibility)
  hidden.forEach(el => { el.style.visibility = 'hidden' })

  try {
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()

    // Wait ~2 repaint cycles + a safety margin for the stream to advance to
    // a frame that reflects the hidden DOM.
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    await new Promise(r => setTimeout(r, 120))

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d unavailable')
    ctx.drawImage(video, 0, 0)

    return await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
  } finally {
    stream.getTracks().forEach(t => t.stop())
    hidden.forEach((el, i) => { el.style.visibility = prev[i] })
  }
}
