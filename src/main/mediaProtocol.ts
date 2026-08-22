import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { join, resolve, sep } from 'node:path'
import { mediaRoot } from './paths'

/**
 * media://app/<relative-path> serves files strictly from inside the media root.
 * The DB stores relative paths only; the renderer never sees absolute paths.
 */

export function registerMediaSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

export function registerMediaProtocolHandler(): void {
  protocol.handle('media', (request) => {
    const url = new URL(request.url)
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const root = mediaRoot()
    const target = resolve(join(root, relative))
    if (target !== root && !target.startsWith(root + sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(target).toString())
  })
}
