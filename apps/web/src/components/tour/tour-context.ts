import * as React from 'react'

export interface TourContextValue {
  /** `opener` is the control that started the tour; focus returns to it when the tour ends. */
  startTour: (opener?: HTMLElement | null) => void
  isRunning: boolean
  /** Runs the sample-stage action behind an interactive step, same as clicking its control. */
  performStageAction: (stepId: string) => void
}

export const TourContext = React.createContext<TourContextValue | null>(null)

export function useTour(): TourContextValue | null {
  return React.useContext(TourContext)
}
