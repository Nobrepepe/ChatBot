import type { ReactNode } from 'react'

export function Eyebrow({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="eyebrow">{children}</p>
}

export function Rule({ end = 74 }: { end?: number }): React.JSX.Element {
  return <hr className="rule" style={{ ['--rule-end' as string]: `${end}%` }} />
}

export function VRule({ height }: { height?: number | string }): React.JSX.Element {
  return <div className="vrule" style={{ height }} />
}

interface TextActionProps {
  children: ReactNode
  onClick?: () => void
  kind?: 'primary' | 'secondary' | 'destructive'
  size?: number
  sub?: ReactNode
  disabled?: boolean
  title?: string
}

export function TextAction({
  children,
  onClick,
  kind = 'primary',
  size,
  sub,
  disabled,
  title
}: TextActionProps): React.JSX.Element {
  const cls =
    kind === 'primary'
      ? 'text-action'
      : kind === 'secondary'
        ? 'text-action text-action--secondary'
        : 'text-action text-action--destructive'
  return (
    <span>
      <button
        type="button"
        className={cls}
        onClick={onClick}
        disabled={disabled}
        title={title}
        style={size ? { fontSize: `calc(${size}px * var(--text-scale))` } : undefined}
      >
        {children}
      </button>
      {sub ? <span className="text-action-sub">{sub}</span> : null}
    </span>
  )
}

interface TextTabsProps<T extends string> {
  items: readonly T[]
  selected: T
  onSelect: (item: T) => void
  neutral?: boolean
  labels?: Partial<Record<T, string>>
}

export function TextTabs<T extends string>({
  items,
  selected,
  onSelect,
  neutral,
  labels
}: TextTabsProps<T>): React.JSX.Element {
  return (
    <div className="text-tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          role="tab"
          aria-selected={item === selected}
          className={neutral ? 'text-tab text-tab--neutral' : 'text-tab'}
          onClick={() => onSelect(item)}
        >
          {labels?.[item] ?? item}
        </button>
      ))}
    </div>
  )
}

export function FadingBar({
  fill,
  width
}: {
  /** 0..1 */
  fill: number
  width?: number | string
}): React.JSX.Element {
  const clamped = Math.max(0, Math.min(1, fill))
  return (
    <div className="fading-bar" style={{ width }}>
      <div className="fading-bar-track" />
      <div className="fading-bar-fill" style={{ width: `${clamped * 100}%` }} />
    </div>
  )
}

export function PulseDot({
  label,
  color
}: {
  label: string
  color?: string
}): React.JSX.Element {
  return (
    <span className="pulse-dot" style={color ? { ['--pulse-color' as string]: color } : undefined}>
      {label}
    </span>
  )
}

export function HeroNumeral({
  value,
  label
}: {
  value: ReactNode
  label: ReactNode
}): React.JSX.Element {
  return (
    <div>
      <span
        className="display"
        style={{ fontSize: 'var(--size-display-l)', lineHeight: 0.95, display: 'block' }}
      >
        {value}
      </span>
      <span className="caption">{label}</span>
    </div>
  )
}
