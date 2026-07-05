import { ArrowRight } from 'lucide-react'
import { Badge } from '@repo/ui'
import type { LucideIcon } from 'lucide-react'
import { Reveal } from '@/components/motion/reveal'

export type FeatureListItem = {
  eyebrow: string
  title: string
  description: string
  icon: LucideIcon
}

export function FeatureList({ items }: { items: FeatureListItem[] }) {
  return (
    <div className="divide-y divide-border/70 overflow-hidden rounded-[2rem] border border-border/70 bg-card/60">
      {items.map((item, index) => {
        const Icon = item.icon
        return (
          <Reveal key={item.title} delay={index * 80}>
            <div className="group flex flex-col gap-4 p-6 transition-colors duration-300 hover:bg-secondary/40 sm:flex-row sm:items-center">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Icon className="size-5" />
              </div>

              <div className="flex-1">
                <Badge variant="outline" className="w-fit">
                  {item.eyebrow}
                </Badge>

                <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em]">
                  {item.title}
                </h3>

                <p className="mt-1 text-sm leading-7 text-muted-foreground">
                  {item.description}
                </p>
              </div>

              <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:translate-x-1 group-hover:text-primary" />
            </div>
          </Reveal>
        )
      })}
    </div>
  )
}
