// Simple Gravatar avatar — feeds on an emailMd5 string the backend already
// computed (we never have the raw email on the public surface). Falls back
// to Gravatar's identicon for users without a Gravatar-registered email.
//
// Used in:
//  - Community feed cards
//  - Public report view byline
//  - Self-profile preview in settings

type GravatarProps = {
  emailMd5: string
  size?: number
  alt?: string
  className?: string
}

export function Gravatar({ emailMd5, size = 32, alt = 'avatar', className }: GravatarProps) {
  // d=identicon: deterministic geometric avatar derived from the hash when
  // the email isn't registered with Gravatar. r=g: limit to G-rated images.
  // s=size*2: serve a 2x version for retina; CSS sizing scales it down.
  const src = `https://www.gravatar.com/avatar/${emailMd5}?d=identicon&r=g&s=${size * 2}`
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={alt}
      loading="lazy"
      decoding="async"
      // Default rounded look; consumers can override via className.
      className={className ?? 'rounded-full bg-zinc-800'}
      style={{ width: size, height: size }}
    />
  )
}
