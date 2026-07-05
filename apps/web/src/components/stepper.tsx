import { Reveal } from '@/components/motion/reveal'

export type StepperStep = {
  step: string
  title: string
  description: string
}

export function Stepper({ steps }: { steps: StepperStep[] }) {
  return (
    <div className="grid gap-8 lg:grid-cols-3">
      {steps.map((item, index) => (
        <Reveal key={item.step} delay={index * 100}>
          <div>
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-primary text-sm font-semibold text-primary">
                {item.step}
              </span>
              {index < steps.length - 1 ? (
                <span aria-hidden="true" className="hidden h-px flex-1 bg-primary/30 lg:block" />
              ) : null}
            </div>

            <h3 className="mt-5 text-xl font-semibold tracking-[-0.02em]">
              {item.title}
            </h3>

            <p className="mt-2 text-sm leading-7 text-foreground/75">
              {item.description}
            </p>
          </div>
        </Reveal>
      ))}
    </div>
  )
}
