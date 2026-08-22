import { useQueryClient } from '@tanstack/react-query'
import type { HubUpdatePreview } from '@shared/ipc'
import { Eyebrow, Rule, TextAction } from '../../components/primitives'
import { useOverlay } from '../../components/overlay'
import { useSnack } from '../../components/snack'
import { call } from '../../lib/api'
import { useIpcQuery } from '../../lib/queries'

export default function WorldHubSection(): React.JSX.Element {
  const overlay = useOverlay()
  const { snack } = useSnack()
  const client = useQueryClient()
  const statusQuery = useIpcQuery('hub:status')
  const status = statusQuery.data

  function refresh(): void {
    client.invalidateQueries()
  }

  function showPreview(stagedId: number, preview: HubUpdatePreview): void {
    overlay.open({
      eyebrow: 'World Hub',
      title: `Activate “${preview.productionName}”?`,
      render: (close) => (
        <div className="block">
          {preview.alreadyActive ? (
            <p className="body-text">This publication is already active.</p>
          ) : null}
          {preview.addedWorlds.length ? (
            <p className="body-text">Worlds added: {preview.addedWorlds.join(', ')}.</p>
          ) : null}
          {preview.addedCharacters.length ? (
            <p className="body-text">Characters added: {preview.addedCharacters.join(', ')}.</p>
          ) : null}
          {preview.updatedCharacters.length ? (
            <p className="body-text">Characters updated: {preview.updatedCharacters.join(', ')}.</p>
          ) : null}
          {preview.retiredCharacters.length ? (
            <p className="body-text">
              Characters retiring (old conversations keep them):{' '}
              {preview.retiredCharacters.join(', ')}.
            </p>
          ) : null}
          <p className="body-text">
            {preview.loreDocuments} lore document{preview.loreDocuments === 1 ? '' : 's'} included.
            {preview.pinnedScenes > 0
              ? ` ${preview.pinnedScenes} existing conversation${preview.pinnedScenes === 1 ? ' stays' : 's stay'} pinned to the canon they began with.`
              : ''}
          </p>
          <p className="caption">
            Scenes, messages, memories, personas, and notes are never touched. A failed import
            changes nothing.
          </p>
          <div className="overlay-actions">
            <TextAction
              onClick={async () => {
                try {
                  await call('hub:activate', stagedId)
                  snack('The publication is now active. New conversations use it.')
                  refresh()
                } catch (err) {
                  snack((err as Error).message, true)
                }
                close()
              }}
            >
              Activate →
            </TextAction>
            <TextAction
              kind="secondary"
              onClick={async () => {
                await call('hub:cancelStaged', stagedId).catch(() => undefined)
                close()
              }}
            >
              Cancel
            </TextAction>
          </div>
        </div>
      )
    })
  }

  const receipt = status?.receipt

  return (
    <div className="block" style={{ maxWidth: 640 }}>
      <Eyebrow>World Hub content</Eyebrow>
      <p className="body-text">
        {status?.hubMode && receipt
          ? `Hub mode — “${receipt['productionName']}” revision ${receipt['productionRevision']}, ` +
            `publication ${String(status.publicationId).slice(0, 8)}…, imported ${String(receipt['importedAt']).slice(0, 10)}.`
          : status?.hubMode
            ? `Hub mode — publication ${String(status.publicationId).slice(0, 8)}….`
            : 'Legacy mode — worlds and characters are authored in this app. Install a World Hub publication to make the Hub the canon source.'}
      </p>
      <p className="caption">
        Linked folder: {status?.linkedFolder || 'No production folder linked.'}
      </p>
      <Rule end={60} />
      <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <TextAction
          kind="secondary"
          onClick={async () => {
            try {
              const result = await call('hub:stageZip')
              if (result) showPreview(result.stagedId, result.preview)
            } catch (err) {
              snack((err as Error).message, true)
            }
          }}
        >
          Install publication ZIP →
        </TextAction>
        <TextAction
          kind="secondary"
          onClick={async () => {
            try {
              const linked = await call('hub:linkFolder')
              if (linked) {
                snack('Production folder linked.')
                refresh()
              }
            } catch (err) {
              snack((err as Error).message, true)
            }
          }}
        >
          Link production folder →
        </TextAction>
        {status?.linkedFolder ? (
          <TextAction
            kind="secondary"
            onClick={async () => {
              try {
                const result = await call('hub:stageLinkedFolder')
                showPreview(result.stagedId, result.preview)
              } catch (err) {
                snack((err as Error).message, true)
              }
            }}
          >
            Check for update →
          </TextAction>
        ) : null}
        {status?.previousPublicationId ? (
          <TextAction
            kind="destructive"
            onClick={async () => {
              try {
                await call('hub:rollback')
                snack('Rolled back to the previous publication.')
                refresh()
              } catch (err) {
                snack((err as Error).message, true)
              }
            }}
          >
            Roll back
          </TextAction>
        ) : null}
      </div>
      <p className="caption">
        The publication is copied into this app&apos;s data, so everything keeps working when the
        Hub library is unavailable.
      </p>
    </div>
  )
}
