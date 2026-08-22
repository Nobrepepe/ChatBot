import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface SnackContextValue {
  snack: (message: string, error?: boolean) => void
}

const SnackContext = createContext<SnackContextValue | null>(null)

export function useSnack(): SnackContextValue {
  const ctx = useContext(SnackContext)
  if (!ctx) throw new Error('useSnack outside SnackProvider')
  return ctx
}

export function SnackProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [current, setCurrent] = useState<{ message: string; error: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const snack = useCallback((message: string, error = false) => {
    setCurrent({ message, error })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCurrent(null), error ? 5200 : 3200)
  }, [])

  return (
    <SnackContext.Provider value={{ snack }}>
      {children}
      {current ? (
        <div className="snack-host" role="status">
          <div className="snack" data-error={current.error || undefined}>
            {current.message}
          </div>
        </div>
      ) : null}
    </SnackContext.Provider>
  )
}
