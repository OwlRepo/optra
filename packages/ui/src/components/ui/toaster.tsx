'use client'

import * as React from 'react'
import { CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'
import { cn } from '../../lib/utils'

export type ToastVariant = 'default' | 'success' | 'error' | 'loading'

interface ToastItem {
  id: string
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

interface ToastInput extends Omit<ToastItem, 'id'> {
  id?: string
}

interface ToastContextValue {
  toasts: ToastItem[]
  toast: (input: ToastInput) => string
  updateToast: (id: string, input: Partial<ToastInput>) => void
  dismissToast: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

// Storyboard 01 C14: every toast is a white card; the tone lives only in the
// 3px inset rule and the icon. Text stays ink (title) / body ink (description)
// so copy is always readable -- the reason surface and text were split.
const variantRule: Record<ToastVariant, string> = {
  default: 'inset-shadow-[3px_0_0_var(--border-dashed)]',
  success: 'inset-shadow-[3px_0_0_var(--primary-strong)]',
  error: 'inset-shadow-[3px_0_0_var(--destructive-tone)]',
  loading: 'inset-shadow-[3px_0_0_var(--primary-strong)]/50',
}

const variantIconColor: Record<ToastVariant, string> = {
  default: 'text-ink-muted',
  success: 'text-primary-strong',
  error: 'text-destructive-tone',
  loading: 'text-primary-strong',
}

const variantIcon: Record<ToastVariant, React.ReactNode> = {
  default: <Info className="size-[17px]" aria-hidden="true" />,
  success: <CheckCircle2 className="size-[17px]" aria-hidden="true" />,
  error: <XCircle className="size-[17px]" aria-hidden="true" />,
  loading: <Loader2 className="size-[17px] animate-[spin_0.9s_linear_infinite]" aria-hidden="true" />,
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])
  const timers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const clearTimer = React.useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const dismissToast = React.useCallback(
    (id: string) => {
      clearTimer(id)
      setToasts((current) => current.filter((toast) => toast.id !== id))
    },
    [clearTimer]
  )

  const scheduleDismiss = React.useCallback(
    (id: string, variant?: ToastVariant, duration?: number) => {
      clearTimer(id)
      if (variant === 'loading') {
        return
      }

      const timeout = setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id))
        timers.current.delete(id)
      }, duration ?? 4200)

      timers.current.set(id, timeout)
    },
    [clearTimer]
  )

  const toast = React.useCallback(
    ({ id, variant = 'default', duration, ...input }: ToastInput) => {
      const nextId = id ?? crypto.randomUUID()
      setToasts((current) => [{ id: nextId, variant, duration, ...input }, ...current].slice(0, 4))
      scheduleDismiss(nextId, variant, duration)
      return nextId
    },
    [scheduleDismiss]
  )

  const updateToast = React.useCallback(
    (id: string, input: Partial<ToastInput>) => {
      setToasts((current) =>
        current.map((toast) =>
          toast.id === id ? { ...toast, ...input, id } : toast
        )
      )
      scheduleDismiss(id, input.variant, input.duration)
    },
    [scheduleDismiss]
  )

  React.useEffect(() => {
    return () => {
      timers.current.forEach((timer) => clearTimeout(timer))
      timers.current.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, toast, updateToast, dismissToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:justify-end">
        <div className="flex w-full max-w-sm flex-col gap-3">
          {toasts.map((item) => {
            const variant = item.variant ?? 'default'

            return (
              <div
                key={item.id}
                className={cn(
                  'pointer-events-auto fade-slide-in flex items-start gap-3 rounded-[14px] border border-border-panel bg-card px-4 py-[14px] text-foreground shadow-toast',
                  variantRule[variant]
                )}
                role="status"
                aria-live="polite"
              >
                <div className={cn('mt-px shrink-0', variantIconColor[variant])}>{variantIcon[variant]}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-foreground">{item.title}</div>
                  {item.description ? (
                    <p className="mt-[3px] text-[14px] text-ink-body">{item.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(item.id)}
                  className="-m-1 shrink-0 rounded-[6px] p-1 text-ink-muted transition-colors duration-200 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong"
                  aria-label="Dismiss notification"
                >
                  <X className="size-[15px]" aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = React.useContext(ToastContext)

  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }

  return context
}
