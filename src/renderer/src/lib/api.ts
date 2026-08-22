import type { IpcChannel, IpcMethods } from '@shared/ipc'

/** Error rethrown in the renderer with the main-process message intact. */
export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** Typed call into the main process; unwraps the IpcResult envelope. */
export async function call<K extends IpcChannel>(
  channel: K,
  ...args: Parameters<IpcMethods[K]>
): Promise<ReturnType<IpcMethods[K]>> {
  const result = await window.api.invoke(channel, ...args)
  if (!result.ok) throw new ApiError(result.code, result.message)
  return result.value as ReturnType<IpcMethods[K]>
}
