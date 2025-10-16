import { forwardRef, type TextareaHTMLAttributes } from 'react'

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', rows = 4, ...props }, ref) => {
    const baseClasses =
      'w-full rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 shadow-inner shadow-slate-950/40 transition focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-50'

    return (
      <textarea
        ref={ref}
        className={`${baseClasses}${className ? ` ${className}` : ''}`}
        rows={rows}
        {...props}
      />
    )
  },
)

Textarea.displayName = 'Textarea'

export { Textarea }
