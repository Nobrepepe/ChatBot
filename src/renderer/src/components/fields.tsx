import { useId } from 'react'

interface FieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  lines?: number
  readOnly?: boolean
  type?: 'text' | 'password'
  autoFocus?: boolean
}

/** Underlined input — no plate, no radius. The label is an eyebrow. */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  lines,
  readOnly,
  type = 'text',
  autoFocus
}: FieldProps): React.JSX.Element {
  const id = useId()
  return (
    <div className="field">
      <label className="eyebrow" htmlFor={id}>
        {label}
      </label>
      {lines && lines > 1 ? (
        <textarea
          id={id}
          rows={lines}
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

interface SelectRowProps {
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
}

/** Underlined select. The popup is the OS menu; the closed state is quiet text. */
export function SelectRow({
  label,
  value,
  options,
  onChange,
  disabled
}: SelectRowProps): React.JSX.Element {
  const id = useId()
  return (
    <div className="field">
      <label className="eyebrow" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
