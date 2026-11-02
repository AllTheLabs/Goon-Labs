import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  detail?: string
}

const ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info }

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind]
        return (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            <Icon size={18} className="toast-icon" />
            <div className="toast-text">
              <div className="toast-title">{toast.title}</div>
              {toast.detail && <div className="toast-detail">{toast.detail}</div>}
            </div>
            <button className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
