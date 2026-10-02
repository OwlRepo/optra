import { MicroLabel, cn } from '@repo/ui'
import { BrandMark } from '@/components/brand-mark'

const SIDEBAR_BAR_WIDTHS = ['w-[70%]', 'w-[85%]', 'w-[60%]', 'w-[75%]']
const STAT_CELLS = [0, 1, 2]
const TABLE_ROWS = [0, 1, 2, 3, 4]

export default function RootLoading() {
  return (
    <div className="grid min-h-screen bg-background leading-[normal] lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="hidden flex-col gap-[22px] border-r border-border bg-secondary px-3.5 py-[18px] lg:flex">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <BrandMark decorative className="size-7" />
          <span className="h-3 w-[110px] rounded-[6px] bg-border-definition" />
        </div>
        <div className="flex flex-col gap-2.5 px-2.5">
          {SIDEBAR_BAR_WIDTHS.map((width) => (
            <span key={width} className={cn('h-3 rounded-[6px] bg-border-definition', width)} />
          ))}
        </div>
      </aside>
      <div className="min-w-0">
        <header className="border-b border-border px-5 py-[18px] lg:px-10">
          <MicroLabel as="p">Loading workspace…</MicroLabel>
          <div className="mt-2.5 h-[22px] w-[260px] max-w-full rounded-[8px] bg-surface-skeleton" />
        </header>
        <div className="flex flex-col gap-5 px-4 py-8 lg:px-10">
          <div className="grid grid-cols-3 overflow-hidden rounded-[18px] border border-border-panel bg-card">
            {STAT_CELLS.map((cell) => (
              <div
                key={cell}
                className={cn('flex flex-col gap-2.5 p-5', cell < STAT_CELLS.length - 1 && 'border-r border-border-inner')}
              >
                <span className="h-2.5 w-1/2 rounded-[6px] bg-surface-skeleton" />
                <span className="h-[26px] w-[30%] rounded-[8px] bg-surface-skeleton" />
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-[18px] border border-border-panel bg-card">
            <div className="h-11 bg-secondary" />
            {TABLE_ROWS.map((row) => (
              <div
                key={row}
                className="grid grid-cols-[1.4fr_1fr_0.8fr_0.6fr] gap-[18px] border-t border-border-inner px-5 py-4"
              >
                <div className="relative h-3.5 overflow-hidden rounded-[8px] bg-surface-skeleton">
                  <div
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-[34%] animate-[rf-sweep_1.6s_cubic-bezier(0.4,0,0.6,1)_infinite] bg-[linear-gradient(90deg,transparent,oklch(0.5_0.09_184/0.18),transparent)]"
                    style={{ animationDelay: `${row * 0.15}s` }}
                  />
                </div>
                <div className="h-3.5 w-[70%] rounded-[8px] bg-surface-skeleton" />
                <div className="h-3.5 w-[60%] rounded-full bg-surface-skeleton" />
                <div className="h-3.5 w-[40%] rounded-[8px] bg-surface-skeleton" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
