import { CheckCircle2 } from 'lucide-react'
import { Card, CardContent } from '@repo/ui'

export interface UseCase {
  label: string
  detail?: string
}

interface UseCaseCloudProps {
  useCases: UseCase[]
}

export function UseCaseCloud({ useCases }: UseCaseCloudProps) {
  const featured = useCases.slice(0, 2)
  const rest = useCases.slice(2)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {featured.map((useCase) => (
          <Card key={useCase.label} className="h-full">
            <CardContent className="flex items-start gap-3 pt-6">
              <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-medium">{useCase.label}</p>
                {useCase.detail ? <p className="text-sm text-muted-foreground">{useCase.detail}</p> : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {rest.map((useCase) => (
          <span
            key={useCase.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary/60 px-3 py-1.5 text-sm text-muted-foreground"
          >
            <CheckCircle2 className="size-3.5 text-primary" aria-hidden="true" />
            {useCase.label}
          </span>
        ))}
      </div>
    </div>
  )
}
