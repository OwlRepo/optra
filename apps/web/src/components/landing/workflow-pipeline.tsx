import { Badge, Card, CardContent, ConfidenceMeter } from '@repo/ui'
import AnimatedContent from '../AnimatedContent'
import { HERO_MATCH_EXAMPLE } from '@/lib/landing-example'

export interface WorkflowStepData {
  title: string
  description: string
}

interface WorkflowPipelineProps {
  steps: WorkflowStepData[]
}

export function WorkflowPipeline({ steps }: WorkflowPipelineProps) {
  const [connect, match, review] = steps

  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_0.8fr_1.2fr]">
      {connect ? (
        <AnimatedContent>
          <Card className="h-full border-dashed">
            <CardContent className="flex h-full flex-col gap-3 p-6">
              <div className="flex min-h-[84px] items-center justify-center rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground">
                Drop PO, invoice, or catalog files
              </div>
              <h3 className="font-semibold">{connect.title}</h3>
              <p className="text-sm text-muted-foreground">{connect.description}</p>
            </CardContent>
          </Card>
        </AnimatedContent>
      ) : null}
      {match ? (
        <AnimatedContent>
          <Card className="h-full">
            <CardContent className="flex h-full flex-col gap-3 p-6">
              <div className="flex min-h-[84px] flex-col justify-center">
                <ConfidenceMeter
                  value={HERO_MATCH_EXAMPLE.matchConfidence}
                  label={HERO_MATCH_EXAMPLE.matchConfidenceLabel}
                  size="sm"
                />
              </div>
              <h3 className="font-semibold">{match.title}</h3>
              <p className="text-sm text-muted-foreground">{match.description}</p>
            </CardContent>
          </Card>
        </AnimatedContent>
      ) : null}
      {review ? (
        <AnimatedContent>
          <Card className="h-full border-warning/40 bg-warning/5">
            <CardContent className="flex h-full flex-col gap-3 p-6">
              <div className="flex min-h-[84px] items-center">
                <Badge variant="warning" className="w-fit">
                  Flagged
                </Badge>
              </div>
              <h3 className="font-semibold">{review.title}</h3>
              <p className="text-sm text-muted-foreground">{review.description}</p>
            </CardContent>
          </Card>
        </AnimatedContent>
      ) : null}
    </div>
  )
}
