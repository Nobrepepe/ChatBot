/** User-facing provider failure; the message is shown verbatim in the UI. */
export class ProviderError extends Error {
  code = 'provider'
  constructor(message: string) {
    super(message)
    this.name = 'ProviderError'
  }
}

/**
 * A generation stopped on purpose — the user pressed Stop, or a newer request
 * for the same scene took its slot. The UI drops these silently instead of
 * reporting a failure the user already knows about.
 */
export class CancelledError extends Error {
  code = 'cancelled'
  constructor() {
    super('The request was stopped.')
    this.name = 'CancelledError'
  }
}
