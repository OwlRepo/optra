import { cn } from '@repo/ui'

type BrandMarkProps = {
  className?: string
  decorative?: boolean
}

export function BrandMark({ className, decorative = false }: BrandMarkProps) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      data-brand-mark="mnemra-folded-page"
    >
      <img
        src="/mnemra-mark.svg"
        alt={decorative ? '' : 'Mnemra logo'}
        aria-hidden={decorative ? 'true' : undefined}
        className="h-full w-full"
      />
    </span>
  )
}
