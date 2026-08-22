import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { IpcChannel, IpcMethods } from '@shared/ipc'
import { call } from './api'

/** Query wrapper: one cache entry per channel + args tuple. */
export function useIpcQuery<K extends IpcChannel>(
  channel: K,
  ...args: Parameters<IpcMethods[K]>
): UseQueryResult<ReturnType<IpcMethods[K]>> {
  return useQuery({
    queryKey: [channel, ...args],
    queryFn: () => call(channel, ...args)
  })
}

/** Mutation wrapper that invalidates the given channel prefixes on success. */
export function useIpcMutation<K extends IpcChannel>(
  channel: K,
  invalidates: IpcChannel[] = []
): ReturnType<typeof useMutation<ReturnType<IpcMethods[K]>, Error, Parameters<IpcMethods[K]>>> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (args: Parameters<IpcMethods[K]>) => call(channel, ...args),
    onSuccess: () => {
      for (const prefix of invalidates) {
        client.invalidateQueries({ queryKey: [prefix] })
      }
    }
  })
}
