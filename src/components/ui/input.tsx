import { forwardRef, type InputHTMLAttributes } from 'react'

type InputProps = InputHTMLAttributes<HTMLInputElement>

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', ...props }, ref) => {
    const baseClasses =
      'h-10 w-full rounded-md border border-slate-800 bg-slate-950/60 px-3 text-sm text-slate-100 shadow-inner shadow-slate-950/40 transition focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-50'

    return (
      <input
        ref={ref}
        className={`${baseClasses}${className ? ` ${className}` : ''}`}
        {...props}
      />
    )
  },
)

Input.displayName = 'Input'

export { Input }
