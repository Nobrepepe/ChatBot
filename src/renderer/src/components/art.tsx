import type { CSSProperties } from 'react'

export function mediaUrl(relativePath: string): string {
  return `media://app/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

interface ArtProps {
  path: string
  alt?: string
  /**
   * 'masked'  — opaque art (covers, backdrops): dissolves into the floor.
   * 'alpha'   — transparent-edge character art: contained, never cropped or masked.
   */
  treatment: 'masked' | 'alpha'
  ghost?: boolean
  className?: string
  style?: CSSProperties
}

export function Art({ path, alt = '', treatment, ghost, className, style }: ArtProps): React.JSX.Element {
  const classes = [
    treatment === 'masked' ? 'masked-art' : 'alpha-art',
    ghost ? 'art-ghost' : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ')
  return <img src={mediaUrl(path)} alt={alt} className={classes} style={style} draggable={false} />
}

/** Deliberate no-art fallback: a 45° hatch at the right aspect ratio. */
export function ArtPlaceholder({
  label,
  aspect,
  style
}: {
  label: string
  aspect: `${number}/${number}`
  style?: CSSProperties
}): React.JSX.Element {
  return (
    <div className="hatch" style={{ aspectRatio: aspect, ...style }}>
      <span className="caption">{label}</span>
    </div>
  )
}
