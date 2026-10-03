'use client'

import * as React from 'react'
import { Joyride, type EventHandler, type Props } from 'react-joyride'
import { TourArrow, TourLoader, TourTooltip } from './tour-tooltip'
import { resolveTourTheme } from './tour-theme'
import type { TourStep } from './tour-steps'

export interface TourRunnerProps {
  run: boolean
  stepIndex: number
  steps: TourStep[]
  onEvent: EventHandler
}

const LOCALE: NonNullable<Props['locale']> = {
  back: 'Back',
  close: 'Close',
  last: 'Finish',
  next: 'Next',
  skip: 'Skip tour',
}

// Every visible piece comes from our own components (tooltip, arrow, loader) and
// tokens. The overlay and spotlight are SVG attributes, so their colours are
// resolved from computed tokens when a tour starts and whenever the theme class
// on <html> changes, which keeps light and dark mode in step.
export default function TourRunner({ run, stepIndex, steps, onEvent }: TourRunnerProps) {
  // The theme can flip while a tour runs: re-resolve whenever <html> changes class.
  const [themeVersion, setThemeVersion] = React.useState(0)
  React.useEffect(() => {
    if (!run) return
    const observer = new MutationObserver(() => setThemeVersion((version) => version + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [run])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const theme = React.useMemo(() => (run ? resolveTourTheme() : null), [run, themeVersion])
  if (!theme) return null

  return (
    <Joyride
      continuous
      run={run}
      stepIndex={stepIndex}
      steps={steps}
      onEvent={onEvent}
      locale={LOCALE}
      tooltipComponent={TourTooltip}
      arrowComponent={TourArrow}
      loaderComponent={TourLoader}
      options={{
        arrowBase: 20,
        arrowSize: 10,
        backgroundColor: theme.backgroundColor,
        primaryColor: theme.primaryColor,
        textColor: theme.textColor,
        overlayColor: theme.overlayColor,
        overlayClickAction: false,
        dismissKeyAction: 'close',
        scrollOffset: 96,
        skipBeacon: true,
        spotlightPadding: 6,
        spotlightRadius: 12,
        zIndex: 60,
      }}
      styles={{
        floater: { filter: 'none' },
        spotlight: theme.spotlight,
      }}
    />
  )
}
