/** User-facing provider failure; the message is shown verbatim in the UI. */
export class ProviderError extends Error {
  code = 'provider'
  constructor(message: string) {
    super(message)
    this.name = 'ProviderError'
  }
}
