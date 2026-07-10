import type { LucideIcon } from 'lucide-react'
import { Card, CardContent, PhotoCompare } from '@repo/ui'
import { SpotlightCard } from '../motion/spotlight-card'
import AnimatedContent from '../AnimatedContent'
import { HERO_MATCH_EXAMPLE } from '@/lib/landing-example'

export interface PillarData {
  icon: LucideIcon
  title: string
  description: string
}

interface PillarShowcaseProps {
  pillars: PillarData[]
}

export function PillarShowcase({ pillars }: PillarShowcaseProps) {
  const [flagship, ...rest] = pillars

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      {flagship ? (
        <AnimatedContent>
          <Card className="h-full">
            <CardContent className="flex h-full flex-col gap-6 p-8">
              <flagship.icon className="size-5 text-primary" aria-hidden="true" />
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">{flagship.title}</h3>
                <p className="text-muted-foreground">{flagship.description}</p>
              </div>
              <PhotoCompare
                query={{
                  description: `PO #${HERO_MATCH_EXAMPLE.poNumber} · Line ${HERO_MATCH_EXAMPLE.lineNumber} — ${HERO_MATCH_EXAMPLE.quantity} × ${HERO_MATCH_EXAMPLE.itemDescription}`,
                }}
                candidate={{
                  description: HERO_MATCH_EXAMPLE.itemDescription,
                  vendorName: HERO_MATCH_EXAMPLE.vendorName,
                  photoSrc: HERO_MATCH_EXAMPLE.photoUrl,
                }}
                verdict={{
                  score: HERO_MATCH_EXAMPLE.matchConfidence,
                  isMatch: true,
                  reason: 'Product photo matches the catalog listing',
                }}
              />
            </CardContent>
          </Card>
        </AnimatedContent>
      ) : null}
      <div className="flex flex-col gap-4">
        {rest.map((pillar) => (
          <AnimatedContent key={pillar.title}>
            <SpotlightCard className="h-full">
              <CardContent className="flex flex-col gap-3 p-6">
                <pillar.icon className="size-5 text-primary" aria-hidden="true" />
                <h3 className="font-semibold">{pillar.title}</h3>
                <p className="text-sm text-muted-foreground">{pillar.description}</p>
              </CardContent>
            </SpotlightCard>
          </AnimatedContent>
        ))}
      </div>
    </div>
  )
}
