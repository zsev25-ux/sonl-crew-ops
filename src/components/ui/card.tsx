import { forwardRef, type HTMLAttributes } from 'react'

type CardProps = HTMLAttributes<HTMLDivElement>

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className = '', ...props }, ref) => {
    const baseClasses =
      'rounded-xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg shadow-emerald-900/10 backdrop-blur'

    return (
      <div
        ref={ref}
        className={`${baseClasses}${className ? ` ${className}` : ''}`}
        {...props}
      />
    )
  },
)

Card.displayName = 'Card'

type SectionProps = HTMLAttributes<HTMLDivElement>

function CardHeader({ className = '', ...props }: SectionProps) {
  return (
    <div
      className={`mb-4 flex flex-col gap-1 border-b border-slate-800 pb-4${className ? ` ${className}` : ''}`}
      {...props}
    />
  )
}

type HeadingProps = HTMLAttributes<HTMLHeadingElement>

function CardTitle({ className = '', ...props }: HeadingProps) {
  return (
    <h2
      className={`text-lg font-semibold text-white${className ? ` ${className}` : ''}`}
      {...props}
    />
  )
}

type ParagraphProps = HTMLAttributes<HTMLParagraphElement>

function CardDescription({ className = '', ...props }: ParagraphProps) {
  return (
    <p
      className={`text-sm text-slate-400${className ? ` ${className}` : ''}`}
      {...props}
    />
  )
}

function CardContent({ className = '', ...props }: SectionProps) {
  return (
    <div className={`${className ? className : ''}`} {...props} />
  )
}

function CardFooter({ className = '', ...props }: SectionProps) {
  return (
    <div className={`mt-4${className ? ` ${className}` : ''}`} {...props} />
  )
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
