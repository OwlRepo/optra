import { MicroLabel } from '@repo/ui'
import { BrandMark } from '@/components/brand-mark'

// Frame 4.6: /chat's route-level loading shows the same redirect panel as the
// page, so the hand-off to Purchase Orders reads as one step.
export default function ChatLoading() {
  return (
    <div className="min-h-screen bg-background leading-[normal]">
      <header className="flex items-center gap-2.5 border-b border-border px-5 py-3.5 sm:px-10">
        <BrandMark decorative className="size-7" />
        <span className="font-display text-xl font-semibold tracking-[-0.04em] text-foreground">Optra</span>
      </header>
      <main className="mx-auto box-content max-w-[1040px] px-5 py-16 sm:px-10">
        <div className="relative overflow-hidden rounded-[18px] border border-border-panel bg-card p-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-[34%] animate-[rf-sweep_1.6s_cubic-bezier(0.4,0,0.6,1)_infinite] bg-[linear-gradient(90deg,transparent,oklch(0.5_0.09_184/0.12),transparent)]"
          />
          <MicroLabel as="p" tone="teal">
            Redirecting…
          </MicroLabel>
          <h3 className="mt-3 text-xl">Opening your workspace</h3>
          <p className="mt-2 text-[15px] leading-[1.6] text-ink-body">
            Picking your first available workspace and redirecting you there.
          </p>
        </div>
      </main>
    </div>
  )
}
