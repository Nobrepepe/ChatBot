import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Character, Message } from '@shared/types'
import { parseSpeakerPrefix, stripWirePrefixes } from '@shared/wireFormat'
import { nextInSeries } from '@shared/titleSeries'
import { Screen } from '../../components/Screen'
import { Eyebrow, FadingBar, PulseDot, Rule, TextAction, VRule } from '../../components/primitives'
import { Field } from '../../components/fields'
import { Art, ArtPlaceholder } from '../../components/art'
import { Confirm, useOverlay } from '../../components/overlay'
import { useSnack } from '../../components/snack'
import { ApiError, call } from '../../lib/api'
import { useIpcMutation, useIpcQuery } from '../../lib/queries'
import { useChatStream } from './useChatStream'
import { useStickToBottom } from './useStickToBottom'
import { MemoryProposalList } from './MemoryProposals'
import { PromptDebugBody } from './PromptDebugOverlay'

function Markdown({ children }: { children: string }): React.JSX.Element {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
}

/** The generations that answer in one piece rather than streaming into the transcript. */
type OneShot = 'summarize' | 'impersonate' | 'memories'

const ONE_SHOT_LABEL: Record<OneShot, string> = {
  summarize: 'summarizing',
  impersonate: 'drafting your turn',
  memories: 'reading the scene'
}

/** Live state for a running one-shot: what it is doing, and how to stop it. */
function OneShotProgress({
  kind,
  onCancel
}: {
  kind: OneShot
  onCancel: () => void
}): React.JSX.Element {
  return (
    <span style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'baseline' }}>
      <PulseDot label={ONE_SHOT_LABEL[kind]} />
      <TextAction
        kind="secondary"
        onClick={onCancel}
        title="Stop the generation and free the model"
      >
        Stop
      </TextAction>
    </span>
  )
}

export default function ChatScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const overlay = useOverlay()
  const { snack } = useSnack()
  const client = useQueryClient()
  const params = useParams<{ sceneId: string }>()
  const sceneId = Number(params.sceneId)

  const sceneQuery = useIpcQuery('scenes:get', sceneId)
  const scene = sceneQuery.data ?? null
  const worldQuery = useIpcQuery('worlds:get', scene?.worldId ?? -1)
  const charactersQuery = useIpcQuery('characters:list', scene?.worldId ?? -1)
  const messagesQuery = useIpcQuery('messages:list', sceneId)
  const settingsQuery = useIpcQuery('settings:get')
  const personasQuery = useIpcQuery('personas:list')

  const world = worldQuery.data ?? null
  const cast: Character[] = useMemo(
    () =>
      (scene?.characterIds ?? [])
        .map((id) => (charactersQuery.data ?? []).find((c) => c.id === id))
        .filter((c): c is Character => !!c),
    [scene, charactersQuery.data]
  )
  const multi = cast.length > 1
  const castNames = useMemo(() => cast.map((c) => c.name), [cast])
  const retiredCast = useMemo(() => cast.filter((c) => c.retiredAt), [cast])
  const persona = scene?.personaId
    ? (personasQuery.data ?? []).find((p) => p.id === scene.personaId)
    : undefined

  const [draft, setDraft] = useState('')
  const [responderId, setResponderId] = useState<number | null>(null)
  const responder = cast.find((c) => c.id === responderId) ?? cast[0]
  const [castOpen, setCastOpen] = useState(false)
  const closeCast = useCallback(() => setCastOpen(false), [])

  // Per-scene display mode with the global setting as fallback.
  const displayMode =
    scene?.displayMode ?? (settingsQuery.data?.displayMode === 'vn' ? 'vn' : 'chat')
  const setDisplayMode = useIpcMutation('scenes:setDisplayMode', ['scenes:get'])

  // Held as state, not refs: neither element exists until the scene has loaded,
  // and the pin has to run when they appear.
  const [transcript, setTranscript] = useState<HTMLDivElement | null>(null)
  const [transcriptContent, setTranscriptContent] = useState<HTMLDivElement | null>(null)

  function refreshMessages(): void {
    client.invalidateQueries({ queryKey: ['messages:list', sceneId] })
    client.invalidateQueries({ queryKey: ['scenes:get', sceneId] })
  }

  const stream = useChatStream(
    (trouble) => {
      refreshMessages()
      if (trouble) snack(trouble, true)
    },
    (message) => {
      refreshMessages()
      snack(message, true)
    }
  )

  // Summary, impersonation and memory suggestions each cost a full prompt and
  // cannot usefully overlap — with a streamed reply either. The ref is the
  // real guard (state lands too late to stop a second click); the state only
  // drives what the buttons look like while one runs.
  const [oneShot, setOneShot] = useState<OneShot | null>(null)
  const oneShotRef = useRef<OneShot | null>(null)
  const canGenerate = oneShot === null && !stream.busy

  async function runOneShot<T>(kind: OneShot, run: () => Promise<T>): Promise<T | null> {
    if (oneShotRef.current !== null || stream.busy) return null
    oneShotRef.current = kind
    setOneShot(kind)
    try {
      return await run()
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== 'cancelled')
        snack((err as Error).message, true)
      return null
    } finally {
      oneShotRef.current = null
      setOneShot(null)
    }
  }

  function cancelOneShot(): void {
    void call('chat:cancelOneShot', sceneId)
  }

  const messages = messagesQuery.data ?? []
  const historyLimit = Math.max(1, Number(settingsQuery.data?.historyLimit ?? 30) || 30)
  const sent = Math.min(messages.length, historyLimit)

  // Live speaker detection: flips the header as soon as {Name} streams in.
  const liveSpeaker = useMemo(() => {
    if (stream.streamText === null) return null
    const parsed = parseSpeakerPrefix(stream.streamText, castNames)
    return parsed?.name ?? responder?.name ?? null
  }, [stream.streamText, castNames, responder])

  // The character whose portrait is on stage, and the emotion driving the sprite.
  const lastCharacterMessage = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'character'),
    [messages]
  )
  const liveEmotion =
    stream.streamText !== null ? stripWirePrefixes(stream.streamText, castNames).emotion : ''
  const displayCharacter =
    (liveSpeaker && cast.find((c) => c.name === liveSpeaker)) ||
    cast.find((c) => c.id === lastCharacterMessage?.characterId) ||
    responder
  const spritesQuery = useIpcQuery('sprites:list', displayCharacter?.id ?? -1)
  const stageEmotion = liveEmotion || lastCharacterMessage?.emotion || ''
  const stagePortrait =
    (spritesQuery.data ?? []).find((s) => s.callSign === stageEmotion)?.imagePath ||
    displayCharacter?.portraitPath ||
    ''

  // Entering a scene lands on its last line, and stays there while the reader
  // is reading the newest one.
  useStickToBottom(transcript, transcriptContent, messagesQuery.isSuccess)

  function speakerFor(message: Message): string {
    if (message.role === 'user') return persona?.name ?? 'You'
    if (message.role === 'system-note') return ''
    if (message.role === 'narrator') return 'Narrator'
    const character = cast.find((c) => c.id === message.characterId)
    return character?.name ?? cast[0]?.name ?? 'Character'
  }

  async function send(): Promise<void> {
    const text = draft.trim()
    if (!text || !canGenerate) return
    setDraft('')
    await stream.start({ kind: 'reply', sceneId, userMessage: text, responderId: responder?.id })
    refreshMessages()
  }

  async function regenerate(): Promise<void> {
    if (!canGenerate || messages.length === 0) return
    const last = messages[messages.length - 1]!
    if (last.role !== 'user') {
      await call('messages:delete', last.id)
      refreshMessages()
    }
    await stream.start({ kind: 'reply', sceneId, responderId: responder?.id })
  }

  async function impersonate(): Promise<void> {
    const suggestion = await runOneShot('impersonate', () =>
      call('chat:impersonate', sceneId, draft)
    )
    if (suggestion !== null) setDraft(suggestion)
  }

  function editMessage(message: Message): void {
    overlay.open({
      eyebrow: 'Edit',
      title: `${speakerFor(message)}'s turn.`,
      render: (close) => <MessageEditor message={message} close={close} />
    })
  }

  function MessageEditor({
    message,
    close
  }: {
    message: Message
    close: () => void
  }): React.JSX.Element {
    const [text, setText] = useState(message.content)
    const continuable = message.role === 'character' || message.role === 'narrator'
    return (
      <div className="block">
        <Field label="Message" value={text} onChange={setText} lines={8} autoFocus />
        <div className="overlay-actions">
          <TextAction
            onClick={async () => {
              await call('messages:update', message.id, text)
              refreshMessages()
              close()
            }}
          >
            Save the message →
          </TextAction>
          {continuable ? (
            <TextAction
              kind="secondary"
              onClick={async () => {
                await call('messages:update', message.id, text)
                close()
                await stream.start({
                  kind: 'continuation',
                  sceneId,
                  messageId: message.id,
                  partial: text
                })
              }}
              title="The AI finishes the reply from where the kept text stops"
            >
              Save &amp; continue →
            </TextAction>
          ) : null}
        </div>
      </div>
    )
  }

  function deleteMessage(message: Message): void {
    overlay.open({
      eyebrow: 'Confirm',
      title: 'Remove this turn?',
      render: (close) => (
        <Confirm
          body="It will no longer be sent to the model."
          actionLabel="Remove the turn"
          close={close}
          onConfirm={async () => {
            await call('messages:delete', message.id)
            refreshMessages()
          }}
        />
      )
    })
  }

  function rememberMessage(message: Message): void {
    const character = cast.find((c) => c.id === message.characterId) ?? cast[0]
    if (!character) return
    overlay.open({
      eyebrow: 'Remember',
      title: 'What should remain true?',
      render: (close) => (
        <RememberEditor initial={message.content} characterId={character.id} close={close} />
      )
    })
  }

  function RememberEditor({
    initial,
    characterId,
    close
  }: {
    initial: string
    characterId: number
    close: () => void
  }): React.JSX.Element {
    const [text, setText] = useState(initial)
    return (
      <div className="block">
        <Field label="Memory" value={text} onChange={setText} lines={6} autoFocus />
        <p className="caption">Canon memories are injected into every prompt for this character.</p>
        <div className="overlay-actions">
          <TextAction
            onClick={async () => {
              if (!text.trim()) {
                snack('A memory needs something true to carry.', true)
                return
              }
              await call('memories:save', {
                characterId,
                type: 'canon',
                content: text.trim(),
                sourceSceneId: sceneId
              })
              snack('Remembered.')
              close()
            }}
          >
            Keep this memory →
          </TextAction>
        </div>
      </div>
    )
  }

  /**
   * The next scene in the series: same cast, the title advanced one part, and
   * everything this scene remembers carried in as its opening context. It
   * opens scene setup rather than creating the scene — nothing is written
   * until the writer begins it.
   */
  function continueAsNewScene(summary: string): void {
    if (!scene) return
    const previously = [scene.previouslyOn.trim(), summary.trim()].filter(Boolean).join('\n\n')
    navigate(`/world/${scene.worldId}/scene/new`, {
      state: {
        title: nextInSeries(scene.title),
        previouslyOn: previously,
        characterIds: scene.characterIds
      }
    })
  }

  async function summarizeScene(): Promise<void> {
    const summary = await runOneShot('summarize', () => call('chat:summarize', sceneId))
    if (summary === null) return
    refreshMessages()
    overlay.open({
      eyebrow: 'Summary',
      title: 'What this scene now remembers.',
      render: (close) => (
        <div className="block">
          <p className="body-text" style={{ whiteSpace: 'pre-wrap' }}>
            {summary}
          </p>
          <div className="overlay-actions">
            <TextAction
              onClick={() => {
                close()
                continueAsNewScene(summary)
              }}
              sub={`The same cast, carried in as “previously on”. It becomes ${nextInSeries(scene?.title ?? '')}.`}
            >
              Continue as a new scene →
            </TextAction>
          </div>
        </div>
      )
    })
  }

  async function suggestMemories(): Promise<void> {
    const proposals = await runOneShot('memories', () => call('chat:suggestMemories', sceneId))
    if (proposals === null) return
    if (proposals.length === 0) {
      snack('Nothing in the scene changed what they carry.')
      return
    }
    overlay.open({
      eyebrow: 'Memory proposals',
      title: 'Review what they would remember.',
      render: () => (
        <MemoryProposalList
          proposals={proposals}
          onSettled={() => client.invalidateQueries({ queryKey: ['memories:list'] })}
        />
      )
    })
  }

  function inviteCharacters(): void {
    overlay.open({
      eyebrow: 'Cast',
      title: 'Who else is here?',
      render: (close) => <InvitePicker close={close} />
    })
  }

  /**
   * The cast of the world minus the cast of the scene. Inviting appends the
   * chosen characters and notes their arrival in the transcript; the scene
   * becomes a group chat on its own from there.
   */
  function InvitePicker({ close }: { close: () => void }): React.JSX.Element {
    const [picked, setPicked] = useState<Set<number>>(new Set())
    const present = new Set(cast.map((c) => c.id))
    const others = (charactersQuery.data ?? []).filter((c) => !present.has(c.id))

    if (others.length === 0) {
      return <p className="body-text">Everyone in this world is already in the scene.</p>
    }
    return (
      <div className="block">
        <p className="body-text">
          They join from the next reply on, and the model is given their full profile.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 'var(--space-4)'
          }}
        >
          {others.map((c) => {
            const chosen = picked.has(c.id)
            const art = c.tileImagePath || c.portraitPath
            return (
              <button
                key={c.id}
                type="button"
                className="row-line"
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
                onClick={() =>
                  setPicked((current) => {
                    const next = new Set(current)
                    if (next.has(c.id)) next.delete(c.id)
                    else next.add(c.id)
                    return next
                  })
                }
              >
                {art ? (
                  <Art
                    path={art}
                    treatment="alpha"
                    ghost={!chosen}
                    style={{ width: '100%', aspectRatio: '16/9', objectFit: 'contain' }}
                  />
                ) : null}
                <span className="row-title" style={{ fontSize: 'var(--size-title)' }}>
                  {c.name}
                </span>
                <span className="caption" style={chosen ? { color: 'var(--accent)' } : undefined}>
                  {chosen ? 'joins the scene' : 'not invited'}
                </span>
              </button>
            )
          })}
        </div>
        <div className="overlay-actions">
          <TextAction
            disabled={picked.size === 0}
            onClick={async () => {
              try {
                await call('scenes:inviteCharacters', sceneId, [...picked])
                refreshMessages()
                client.invalidateQueries({ queryKey: ['scenes:get', sceneId] })
                snack(picked.size === 1 ? 'They join the scene.' : 'They join the scene together.')
                close()
              } catch (err) {
                snack((err as Error).message, true)
              }
            }}
            sub="The scene becomes a group scene; “Next: …” at the top then chooses who answers."
          >
            {picked.size > 1 ? 'Invite them →' : 'Invite →'}
          </TextAction>
        </div>
      </div>
    )
  }

  /**
   * The direct reply: the chosen character answers the turn that is already
   * there, without a user message. Choosing in the rail does none of this.
   */
  async function answerNow(): Promise<void> {
    if (!canGenerate) return
    setCastOpen(false)
    await stream.start({
      kind: 'reply',
      sceneId,
      responderId: responder?.id,
      respondToLatest: true
    })
  }

  /**
   * Everything a scene can be done to, one step away. These are occasional —
   * read the whole backlog, look at the prompt, bring someone in — and the
   * screen is for the conversation, so they are named here rather than kept on
   * a permanent toolbar the transcript would have to pay for.
   */
  function openSceneActions(): void {
    overlay.open({
      eyebrow: 'This scene',
      title: 'What would you like to do?',
      render: (close) => (
        <div className="block" style={{ gap: 'var(--space-4)' }}>
          <TextAction
            kind="secondary"
            disabled={!canGenerate}
            sub="The AI proposes canon facts from this scene for your review."
            onClick={() => {
              close()
              suggestMemories()
            }}
          >
            Suggest memories →
          </TextAction>
          <TextAction
            kind="secondary"
            sub="Bring another character of this world into the scene."
            onClick={() => {
              close()
              inviteCharacters()
            }}
          >
            Invite character →
          </TextAction>
          <TextAction
            kind="secondary"
            sub="How this scene is shown — only this scene."
            onClick={() => {
              close()
              setDisplayMode.mutate([sceneId, displayMode === 'vn' ? 'chat' : 'vn'])
            }}
          >
            {displayMode === 'vn' ? 'Rolling chat →' : 'Visual novel →'}
          </TextAction>
          {displayMode === 'vn' ? (
            <TextAction
              kind="secondary"
              sub="The visual novel stage shows the latest line; this is all of them."
              onClick={() => {
                close()
                openBacklog()
              }}
            >
              Backlog →
            </TextAction>
          ) : null}
          <TextAction
            kind="secondary"
            sub="What the model is actually sent."
            onClick={() => {
              close()
              overlay.open({
                eyebrow: 'Prompt debug',
                title: 'What the model is actually sent.',
                render: () => <PromptDebugBody sceneId={sceneId} />
              })
            }}
          >
            Prompt debug →
          </TextAction>
          <TextAction
            kind="secondary"
            sub="Writes the whole transcript to a file."
            onClick={async () => {
              close()
              try {
                const path = await call('chat:export', sceneId)
                snack(`Transcript saved to ${path}`)
              } catch (err) {
                snack((err as Error).message, true)
              }
            }}
          >
            Export →
          </TextAction>
        </div>
      )
    })
  }

  function openBacklog(): void {
    overlay.open({
      eyebrow: 'Backlog',
      title: 'Everything said so far.',
      render: () => (
        <div className="block" style={{ gap: 'var(--space-4)' }}>
          {messages.map((m) => (
            <div key={m.id} className="block" style={{ gap: 4 }}>
              <Eyebrow>{speakerFor(m)}</Eyebrow>
              <div className="body-text chat-prose">
                <Markdown>{m.content}</Markdown>
              </div>
              <Rule end={48 + ((m.id * 13) % 36)} />
            </div>
          ))}
        </div>
      )
    })
  }

  if (!scene) return <Screen back={{ label: 'Worlds', to: '/' }}>{null}</Screen>

  const backdropArt = world?.sessionBackgroundPath || world?.coverImagePath

  const streamDisplay =
    stream.streamText !== null ? stripWirePrefixes(stream.streamText, castNames).content : null

  return (
    <Screen
      layout="conversation"
      back={{ label: world?.name ?? 'World', to: `/world/${scene.worldId}/sessions` }}
      rightActions={
        multi ? (
          <TextAction
            kind="secondary"
            onClick={() => setCastOpen((open) => !open)}
            title="Who answers next, and who can answer now"
          >
            Next: {responder?.name ?? 'nobody'}
          </TextAction>
        ) : null
      }
      rail={
        multi && castOpen ? (
          <ResponderDrawer
            cast={cast}
            responder={responder}
            onChoose={setResponderId}
            onAnswerNow={answerNow}
            canGenerate={canGenerate}
            repliesTo={lastCharacterMessage ? speakerFor(lastCharacterMessage) : null}
            onClose={closeCast}
          />
        ) : null
      }
      backdrop={
        backdropArt ? (
          <>
            <Art
              path={backdropArt}
              treatment="masked"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: displayMode === 'vn' ? 0.3 : 0.18
              }}
            />
            <div className="scrim-top" />
          </>
        ) : null
      }
    >
      <div>
        <Eyebrow>
          {world?.name} · {scene.mode} · {castNames.join(', ')}
        </Eyebrow>
        <h1 className="display" style={{ fontSize: 'var(--size-display-m)' }}>
          {scene.title || 'Untitled scene'}
        </h1>
        {retiredCast.length ? (
          <span className="caption">
            {retiredCast.map((c) => c.name).join(' and ')} {retiredCast.length === 1 ? 'is' : 'are'}{' '}
            no longer in the published canon — this scene keeps{' '}
            {retiredCast.length === 1 ? 'them' : 'them all'}.
          </span>
        ) : null}
      </div>

      <div
        style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <span className="caption">
          <span className="display" style={{ fontSize: '1.3rem' }}>
            {sent}
          </span>{' '}
          of {messages.length} messages are being sent
        </span>
        <FadingBar fill={messages.length ? sent / Math.max(messages.length, 1) : 0} width={220} />
        {/* Summarizing is what the counter beside it is asking for, so it stays
            in the open. Everything else a scene can be done to is occasional,
            and occasional actions belong one step away rather than in a toolbar
            that costs the conversation a third of the window. */}
        <TextAction kind="secondary" onClick={summarizeScene} disabled={!canGenerate}>
          Summarize
        </TextAction>
        <TextAction kind="secondary" onClick={openSceneActions}>
          Scene actions →
        </TextAction>
        {oneShot && oneShot !== 'impersonate' ? (
          <OneShotProgress kind={oneShot} onCancel={cancelOneShot} />
        ) : null}
      </div>

      <div className="conversation-stage">
        {stagePortrait ? (
          // Stretched rather than bottom-aligned so the portrait has a height
          // to be a percentage of: in a short window it shrinks with the row
          // instead of pushing the transcript out of the frame.
          <div
            style={{
              flex: '0 0 240px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              gap: 6
            }}
          >
            <Art
              path={stagePortrait}
              treatment="alpha"
              style={{
                width: '100%',
                maxHeight: displayMode === 'vn' ? 'min(520px, 100%)' : 'min(380px, 100%)',
                objectPosition: 'bottom'
              }}
            />
            {stageEmotion ? <span className="caption">[{stageEmotion}]</span> : null}
          </div>
        ) : null}

        {displayMode === 'chat' ? (
          <div ref={setTranscript} className="transcript">
            <div ref={setTranscriptContent} className="transcript-content">
              {messages.map((message) =>
                message.role === 'system-note' ? (
                  <p key={message.id} className="caption" style={{ textAlign: 'center' }}>
                    {message.content}
                  </p>
                ) : (
                  <Turn
                    key={message.id}
                    message={message}
                    speaker={speakerFor(message)}
                    isUser={message.role === 'user'}
                    onEdit={() => editMessage(message)}
                    onDelete={() => deleteMessage(message)}
                    onRemember={
                      message.role === 'character' ? () => rememberMessage(message) : undefined
                    }
                  />
                )
              )}
              {stream.streamText !== null ? (
                <div className="block" style={{ gap: 6 }}>
                  <span style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                    <span className="display" style={{ fontSize: 'var(--size-display-s)' }}>
                      {liveSpeaker}
                    </span>
                    <PulseDot label="answering" />
                  </span>
                  <div className="body-text chat-prose">
                    <Markdown>{(streamDisplay ?? '') + ' ▌'}</Markdown>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <VisualNovelStage
            messages={messages}
            streaming={stream.streamText !== null}
            streamDisplay={streamDisplay}
            liveSpeaker={liveSpeaker}
            speakerFor={speakerFor}
          />
        )}
      </div>

      <div className="block" style={{ gap: 'var(--space-2)' }}>
        <Rule end={80} />
        <Composer
          draft={draft}
          setDraft={setDraft}
          busy={stream.busy}
          status={stream.status}
          oneShot={oneShot}
          onSend={send}
          onStop={stream.cancel}
          onCancelOneShot={cancelOneShot}
          onRegenerate={regenerate}
          onImpersonate={persona ? impersonate : undefined}
        />
      </div>
    </Screen>
  )
}

/**
 * The cast rail. Two actions, deliberately apart: choosing a character only
 * says who takes the next normal turn — it generates nothing — while the one
 * amber action makes that character answer the transcript right now. It sits
 * beside the conversation rather than over it, because choosing who speaks
 * next means reading what was just said.
 */
function ResponderDrawer({
  cast,
  responder,
  onChoose,
  onAnswerNow,
  canGenerate,
  repliesTo,
  onClose
}: {
  cast: Character[]
  responder: Character | undefined
  onChoose: (id: number) => void
  onAnswerNow: () => void
  canGenerate: boolean
  /** Whose turn a direct reply would answer, if anyone has spoken yet. */
  repliesTo: string | null
  onClose: () => void
}): React.JSX.Element {
  // Bubble phase, so an overlay opened over the rail still takes Escape first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="rail-head">
        <Eyebrow>Cast</Eyebrow>
        <TextAction kind="secondary" onClick={onClose}>
          Hide →
        </TextAction>
      </div>

      <div className="block" style={{ gap: 'var(--space-2)' }}>
        <h2 className="display" style={{ fontSize: 'var(--size-display-m)' }}>
          {responder ? `${responder.name} will answer next.` : 'Nobody is chosen yet.'}
        </h2>
        <p className="caption">Choose who takes the next normal turn after you send a message.</p>
      </div>

      <div className="rail-scroll">
        {cast.map((c) => {
          const chosen = responder?.id === c.id
          const art = c.tileImagePath || c.portraitPath
          return (
            <div key={c.id}>
              <button
                type="button"
                className="row-line"
                aria-pressed={chosen}
                onClick={() => onChoose(c.id)}
              >
                {art ? (
                  <Art
                    path={art}
                    treatment="alpha"
                    ghost={!chosen}
                    style={{ flex: '0 0 78px', width: 78, aspectRatio: '4/3' }}
                  />
                ) : (
                  <ArtPlaceholder
                    label="NO PORTRAIT"
                    aspect="4/3"
                    style={{ flex: '0 0 78px', width: 78 }}
                  />
                )}
                <span className="block" style={{ gap: 2 }}>
                  <span className="row-title" style={{ fontSize: 'var(--size-display-s)' }}>
                    {c.name}
                  </span>
                  <span className="caption" style={chosen ? { color: 'var(--accent)' } : undefined}>
                    {chosen ? 'answers the next user turn' : 'waiting'}
                  </span>
                </span>
              </button>
              {chosen ? <Rule accent end={62} /> : null}
            </div>
          )
        })}
      </div>

      <div className="block" style={{ gap: 'var(--space-3)' }}>
        <Rule end={70} />
        <Eyebrow>Direct reply</Eyebrow>
        <TextAction
          onClick={onAnswerNow}
          disabled={!canGenerate || !responder}
          sub={
            repliesTo
              ? `Replies to ${repliesTo}’s latest turn without adding a user message.`
              : 'Opens the scene without waiting for a user message.'
          }
        >
          Let {responder?.name ?? 'them'} answer now →
        </TextAction>
        <p className="caption">Changing the selection does not generate a reply.</p>
        <p className="caption" style={{ color: 'var(--faint)' }}>
          Escape hides the cast.
        </p>
      </div>
    </>
  )
}

function VisualNovelStage({
  messages,
  streaming,
  streamDisplay,
  liveSpeaker,
  speakerFor
}: {
  messages: Message[]
  streaming: boolean
  streamDisplay: string | null
  liveSpeaker: string | null
  speakerFor: (m: Message) => string
}): React.JSX.Element {
  const lastReply = [...messages].reverse().find((m) => m.role !== 'user')
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const speaker = streaming ? liveSpeaker : lastReply ? speakerFor(lastReply) : null
  const text = streaming ? (streamDisplay ?? '') + ' ▌' : (lastReply?.content ?? '')

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap: 'var(--space-3)',
        paddingBottom: 'var(--space-3)'
      }}
    >
      {lastUser ? <span className="caption">You: {lastUser.content}</span> : null}
      <Rule end={70} />
      {speaker ? (
        <span style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
          <span className="display" style={{ fontSize: 'calc(2.2rem * var(--text-scale))' }}>
            {speaker}
          </span>
          {streaming ? <PulseDot label="answering" /> : null}
        </span>
      ) : null}
      <div
        className="body-text chat-prose vn-reply"
        style={{ fontSize: '1.18rem', lineHeight: 1.65, maxWidth: '46em' }}
      >
        <Markdown>{text || 'The scene is waiting for its first line.'}</Markdown>
      </div>
    </div>
  )
}

function Turn({
  message,
  speaker,
  isUser,
  onEdit,
  onDelete,
  onRemember
}: {
  message: Message
  speaker: string
  isUser: boolean
  onEdit: () => void
  onDelete: () => void
  onRemember?: () => void
}): React.JSX.Element {
  const [hover, setHover] = useState(false)
  return (
    <div
      style={{ display: 'flex', gap: 14, paddingLeft: isUser ? 24 : 0 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {isUser ? <VRule /> : null}
      <div className="block" style={{ gap: 4, flex: 1 }}>
        <span style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
          <span
            className="display"
            style={{
              fontSize: isUser ? '1.05rem' : 'var(--size-display-s)',
              color: isUser ? 'var(--muted)' : 'var(--text-1)'
            }}
          >
            {speaker}
          </span>
          <span
            style={{
              display: 'flex',
              gap: 12,
              opacity: hover ? 1 : 0,
              transition: 'opacity 160ms'
            }}
          >
            <button type="button" className="text-action text-action--secondary" onClick={onEdit}>
              Edit
            </button>
            {onRemember ? (
              <button
                type="button"
                className="text-action text-action--secondary"
                onClick={onRemember}
                title="Save as a canon memory"
              >
                Remember
              </button>
            ) : null}
            <button
              type="button"
              className="text-action text-action--destructive"
              onClick={onDelete}
            >
              Delete
            </button>
          </span>
        </span>
        <div className="body-text chat-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

function Composer({
  draft,
  setDraft,
  busy,
  status,
  oneShot,
  onSend,
  onStop,
  onCancelOneShot,
  onRegenerate,
  onImpersonate
}: {
  draft: string
  setDraft: (v: string) => void
  busy: boolean
  /** An automatic pass still owed on this turn; the composer stays locked. */
  status: string | null
  oneShot: OneShot | null
  onSend: () => void
  onStop: () => void
  onCancelOneShot: () => void
  onRegenerate: () => void
  onImpersonate?: () => void
}): React.JSX.Element {
  const canGenerate = oneShot === null && !busy
  return (
    <div className="block" style={{ gap: 'var(--space-2)' }}>
      <div className="field">
        <textarea
          rows={2}
          value={draft}
          placeholder="Say something"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
        />
      </div>
      <div
        style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'baseline', flexWrap: 'wrap' }}
      >
        {status ? (
          <span style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'baseline' }}>
            <PulseDot label={status} />
            <span className="caption">the reply lands when this finishes</span>
          </span>
        ) : busy ? (
          <TextAction size={24} onClick={onStop}>
            Stop →
          </TextAction>
        ) : (
          <TextAction size={24} onClick={onSend} disabled={oneShot !== null}>
            Send →
          </TextAction>
        )}
        <TextAction
          kind="secondary"
          onClick={onRegenerate}
          disabled={!canGenerate}
          title="Replace the last reply"
        >
          Regenerate
        </TextAction>
        {onImpersonate ? (
          oneShot === 'impersonate' ? (
            <OneShotProgress kind={oneShot} onCancel={onCancelOneShot} />
          ) : (
            <TextAction
              kind="secondary"
              onClick={onImpersonate}
              disabled={!canGenerate}
              title="Draft your persona's next turn into the composer"
            >
              Impersonate
            </TextAction>
          )
        ) : null}
        <span className="caption">Enter sends · Shift+Enter makes a new line</span>
      </div>
    </div>
  )
}
