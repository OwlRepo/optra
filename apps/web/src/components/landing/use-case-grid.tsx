import { Reveal } from '@/components/motion/reveal'

const USE_CASES = [
  {
    label: 'Procurement teams',
    detail: 'Match every PO against the vendor catalog before it is approved.',
  },
  {
    label: 'AP / accounts payable',
    detail: 'Catch a price or quantity mismatch before the invoice is paid.',
  },
  {
    label: 'Multi-vendor sourcing',
    detail: 'Compare the same SKU across catalogs from several suppliers.',
  },
  {
    label: 'Ops & supply chain',
    detail: 'Confirm the item that shipped is the item that was ordered.',
  },
  {
    label: 'Small business buyers',
    detail: 'Run vendor checks without hiring a procurement function.',
  },
  {
    label: 'Founder-led purchasing',
    detail: 'Keep every order and price searchable from day one.',
  },
]

export function UseCaseGrid() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1200px] px-[clamp(20px,3.4vw,40px)] py-[clamp(48px,6vw,80px)]">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary-strong">
            Who it&apos;s for
          </p>
          <h2 className="mt-4 max-w-[20ch] font-display text-[clamp(28px,3.2vw,38px)] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground">
            If you buy the same things twice, this pays for itself
          </h2>
        </Reveal>

        <ul className="mt-9 grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4">
          {USE_CASES.map((useCase) => (
            <li
              key={useCase.label}
              className="rounded-2xl border border-[oklch(0.9_0.012_255)] bg-card p-[22px]"
            >
              <h3 className="text-[17px] font-semibold text-foreground">{useCase.label}</h3>
              <p className="mt-2 text-sm leading-[1.65] text-[oklch(0.46_0.02_264)]">
                {useCase.detail}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
