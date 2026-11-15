import { useState } from 'react'
import { Play } from 'lucide-react'

/**
 * Click-to-play YouTube embed. Until the reader clicks, this is one static
 * thumbnail from i.ytimg.com. YouTube's player script is close to a
 * megabyte and sets cookies, so loading it on every landing visit for a
 * video most people won't press play on is the wrong trade. On click the
 * privacy-enhanced iframe (youtube-nocookie.com) mounts with autoplay, so
 * the one click both loads the player and starts the video.
 */
export function YouTubeFacade({ id, title }: { id: string; title: string }) {
  const [playing, setPlaying] = useState(false)

  return (
    <div className="relative aspect-video overflow-hidden rounded-md border border-zinc-800 bg-black">
      {playing ? (
        <iframe
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play video: ${title}`}
          className="group absolute inset-0 h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          <img
            src={`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" aria-hidden />
          <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-amber-400 text-black shadow-[0_6px_30px_rgba(251,191,36,0.55)] transition group-hover:scale-105 group-hover:bg-amber-300">
            <Play aria-hidden className="ml-1 h-7 w-7 fill-current" />
          </span>
          <span className="absolute bottom-3 left-4 right-4 text-left font-mono text-xs text-zinc-200">
            {title}
          </span>
        </button>
      )}
    </div>
  )
}
