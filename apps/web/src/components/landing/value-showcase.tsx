import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@repo/ui'
import AnimatedContent from '../AnimatedContent'

export interface ValueItem {
  eyebrow: string
  title: string
  description: string
  icon: LucideIcon
}

interface ValueShowcaseProps {
  items: ValueItem[]
}

export function ValueShowcase({ items }: ValueShowcaseProps) {
  const [lead, ...rest] = items

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      {lead ? (
        <AnimatedContent>
          <Card className="h-full">
            <CardContent className="flex h-full flex-col justify-center gap-4 p-8">
              <lead.icon className="size-6 text-primary" aria-hidden="true" />
              <p className="text-sm font-medium text-primary">{lead.eyebrow}</p>
              <h3 className="text-xl font-semibold">{lead.title}</h3>
              <p className="text-muted-foreground">{lead.description}</p>
            </CardContent>
          </Card>
        </AnimatedContent>
      ) : null}
      <div className="flex flex-col gap-4">
        {rest.map((item) => (
          <AnimatedContent key={item.title}>
            <Card>
              <CardContent className="flex flex-col gap-2 p-6">
                <item.icon className="size-5 text-primary" aria-hidden="true" />
                <p className="text-xs font-medium text-primary">{item.eyebrow}</p>
                <h3 className="font-semibold">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </CardContent>
            </Card>
          </AnimatedContent>
        ))}
      </div>
    </div>
  )
}
