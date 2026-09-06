import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

/**
 * Dark/light switch. The theme is a `light` class on <html> that remaps the
 * Tailwind palette variables (shared/theme/light.css); dark is the default
 * and needs no class. Each index.html applies the stored choice pre-paint
 * (inline head script) so this component only has to keep <html>, storage
 * and the theme-color meta in sync after user toggles.
 */
export function ThemeToggle({ storageKey }: { storageKey: string }) {
  const [light, setLight] = useState(() => document.documentElement.classList.contains('light'))

  useEffect(() => {
    document.documentElement.classList.toggle('light', light)
    try {
      localStorage.setItem(storageKey, light ? 'light' : 'dark')
    } catch { /* private mode — theme just won't persist */ }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', light ? '#f6f7f9' : '#0a0a0a')
  }, [light, storageKey])

  return (
    <button
      onClick={() => setLight((l) => !l)}
      title={light ? 'Switch to dark mode' : 'Switch to light mode'}
      aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'}
      className="rounded p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
    >
      {light ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  )
}
