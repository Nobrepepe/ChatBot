import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { NoteChatMessage, NoteSuggestion } from '@shared/types'
import { linkNoteReferences } from '@shared/noteLinks'
import { NOTE_CATEGORIES } from '@shared/types'
import { Screen } from '../../components/Screen'
import { Eyebrow, PulseDot, Rule, TextAction, VRule } from '../../components/primitives'
import { Field, SelectRow } from '../../components/fields'
import { Confirm, useOverlay } from '../../components/overlay'
import { useSnack } from '../../components/snack'
import { call } from '../../lib/api'
import { useIpcQuery } from '../../lib/queries'
import { useChatStream } from '../chat/useChatStream'
import { useNotesController } from './useNotesController'
import { NoteBrowser } from './NoteBrowser'
import { NewNoteBody, NoteEditor } from './NoteEditor'

export default function NotesWorkspaceScreen(): React.JSX.Element {
  const params = useParams<{ wid: string }>()
  const worldId = Number(params.wid)
  const overlay = useOverlay()
  const { snack } = useSnack()
  const client = useQueryClient()

  const worldQuery = useIpcQuery('worlds:get', worldId)
  const chatQuery = useIpcQuery('notesChat:list', worldId)
  const ctl = useNotesController(worldId)

  const [draft, setDraft] = useState('')
  const [contextCount, setContextCount] = useState(0)
  const chatRef = useRef<HTMLDivElement>(null)

  function refreshChat(): void {
    client.invalidateQueries({ queryKey: ['notesChat:list'] })
    client.invalidateQueries({ queryKey: ['notesChat:suggestions'] })
    client.invalidateQueries({ queryKey: ['notes:pendingProposals'] })
    ctl.refresh()
  }

  const stream = useChatStream(refreshChat, (message) => {
    refreshChat()
    snack(message, true)
  })

  const messages = chatQuery.data ?? []

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }, [messages.length, stream.streamText])

  // Live "N notes in context" transparency under the composer.
  useEffect(() => {
    const handle = setTimeout(() => {
      call('notes:contextPreview', worldId, draft, ctl.selectedId).then(
        (entries) => setContextCount(entries.length),
        () => setContextCount(0)
      )
    }, 250)
    return () => clearTimeout(handle)
  }, [draft, worldId, ctl.selectedId])

  // Ctrl/Cmd+K opens the note switcher.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openSwitcher()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctl.notes])

  function openSwitcher(): void {
    overlay.open({
      eyebrow: 'Notes',
      title: 'Find a note without leaving the conversation.',
      render: (close) => <Switcher close={close} />
    })
  }

  function Switcher({ close }: { close: () => void }): React.JSX.Element {
    const [query, setQuery] = useState('')
    const needle = query.trim().toLowerCase()
    const results = (
      needle
        ? ctl.notes.filter(
            (n) =>
              n.title.toLowerCase().includes(needle) ||
              n.content.toLowerCase().includes(needle) ||
              n.category.toLowerCase().includes(needle)
          )
        : ctl.notes
    ).slice(0, 12)
    return (
      <div className="block">
        <Field label="Search" value={query} onChange={setQuery} autoFocus placeholder="Type a title…" />
        {results.map((n) => (
          <button
            key={n.id}
            type="button"
            className="row-line"
            onClick={() => {
              close()
              ctl.select(n.id)
            }}
          >
            <span className="row-title" style={{ fontSize: '1rem' }}>{n.title}</span>
            <span className="caption">· {n.category}</span>
          </button>
        ))}
      </div>
    )
  }

  function send(): void {
    const text = draft.trim()
    if (!text || stream.busy) return
    setDraft('')
    void stream.start({ kind: 'notesChat', worldId, userMessage: text, activeNoteId: ctl.selectedId })
    setTimeout(refreshChat, 150)
  }

  async function regenerate(): Promise<void> {
    if (stream.busy) return
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    if (!lastAssistant) return
    await call('notesChat:deleteMessage', lastAssistant.id)
    refreshChat()
    void stream.start({ kind: 'notesChat', worldId, activeNoteId: ctl.selectedId })
  }

  function reviewContext(): void {
    overlay.open({
      eyebrow: 'Context',
      title: 'What the assistant will receive next.',
      render: () => <ContextReview />
    })
  }

  function ContextReview(): React.JSX.Element {
    const [entries, setEntries] = useState<{ noteId: number; title: string; reason: string }[] | null>(null)
    useEffect(() => {
      call('notes:contextPreview', worldId, draft, ctl.selectedId).then(setEntries)
    }, [])
    if (!entries) return <p className="caption">Looking…</p>
    if (entries.length === 0) return <p className="body-text">No notes are selected for the next message.</p>
    return (
      <div className="block">
        {entries.map((e) => (
          <div key={e.noteId} className="row-line">
            <span className="row-title" style={{ fontSize: '1rem' }}>{e.title}</span>
            <span className="caption">{e.reason}</span>
          </div>
        ))}
      </div>
    )
  }

  function openNoteLink(href: string): void {
    const id = Number(href.replace('app-note://', ''))
    const note = ctl.notes.find((n) => n.id === id)
    if (note) ctl.select(note.id)
    else snack('That note is no longer available.', true)
  }

  function newNote(category: string): void {
    overlay.open({
      eyebrow: 'Notes',
      title: 'Give the idea somewhere to live.',
      render: (close) => (
        <NewNoteBody
          worldId={worldId}
          category={category}
          close={close}
          onCreated={(id) => {
            ctl.refresh()
            ctl.select(id)
          }}
        />
      )
    })
  }

  function reviewAll(): void {
    overlay.open({
      eyebrow: 'Proposals',
      title: 'Everything waiting for review.',
      render: () => <ReviewAllBody />
    })
  }

  function ReviewAllBody(): React.JSX.Element {
    const pending = useIpcQuery('notes:pendingProposals', worldId)
    const list = pending.data ?? []
    if (pending.isSuccess && list.length === 0) {
      return <p className="body-text">Nothing is waiting for review.</p>
    }
    return (
      <div className="block">
        {list.map((s) => (
          <ProposalCard key={s.id} suggestion={s} />
        ))}
      </div>
    )
  }

  const ACTION_LABEL: Record<string, string> = {
    create: 'Create',
    append: 'Add to',
    replace: 'Replace',
    open: 'Open'
  }

  function ProposalCard({ suggestion }: { suggestion: NoteSuggestion }): React.JSX.Element {
    const payload = suggestion.payload
    const title = String(payload['title'] ?? '') ||
      ctl.notes.find((n) => n.id === suggestion.targetNoteId)?.title || 'Untitled'
    const preview = String(payload['content'] ?? '').slice(0, 180)
    return (
      <div className="block" style={{ gap: 6 }}>
        <Eyebrow>
          Note proposal · {ACTION_LABEL[suggestion.actionType]} {suggestion.status !== 'pending' ? `· ${suggestion.status}` : ''}
        </Eyebrow>
        <span className="row-title" style={{ fontSize: '1.05rem' }}>{title}</span>
        {preview ? <p className="caption">{preview}</p> : null}
        {suggestion.status === 'pending' && suggestion.actionType !== 'open' ? (
          <span style={{ display: 'flex', gap: 'var(--space-4)' }}>
            <TextAction kind="secondary" onClick={() => reviewOne(suggestion)}>
              Review
            </TextAction>
            <TextAction
              kind="secondary"
              onClick={async () => {
                await approve(suggestion, null)
              }}
            >
              Accept →
            </TextAction>
            <TextAction
              kind="destructive"
              onClick={async () => {
                await call('notes:rejectSuggestion', suggestion.id)
                refreshChat()
              }}
            >
              Reject
            </TextAction>
          </span>
        ) : suggestion.actionType === 'open' && suggestion.targetNoteId ? (
          <TextAction kind="secondary" onClick={() => openNoteLink(`app-note://${suggestion.targetNoteId}`)}>
            Open note →
          </TextAction>
        ) : null}
        <Rule end={54} />
      </div>
    )
  }

  async function approve(
    suggestion: NoteSuggestion,
    edited: { title: string; content: string; category: string; contextMode: string; isPinned: boolean } | null
  ): Promise<void> {
    const payload = suggestion.payload
    const target = ctl.notes.find((n) => n.id === suggestion.targetNoteId)
    const fields = edited ?? {
      title: String(payload['title'] ?? target?.title ?? ''),
      content: String(payload['content'] ?? target?.content ?? ''),
      category: String(payload['category'] ?? target?.category ?? 'Unsorted'),
      contextMode: String(payload['context_mode'] ?? target?.contextMode ?? 'relevant'),
      isPinned: Boolean(payload['is_pinned'] ?? target?.isPinned ?? false)
    }
    try {
      await call('notes:approveSuggestion', suggestion.id, fields)
      snack('The note is now canonical.')
      refreshChat()
    } catch (err) {
      snack((err as Error).message, true)
    }
  }

  function reviewOne(suggestion: NoteSuggestion): void {
    overlay.open({
      eyebrow: 'Proposal',
      title: 'Review before it becomes canon.',
      render: (close) => <ReviewOneBody suggestion={suggestion} close={close} />
    })
  }

  function ReviewOneBody({ suggestion, close }: { suggestion: NoteSuggestion; close: () => void }): React.JSX.Element {
    const payload = suggestion.payload
    const target = ctl.notes.find((n) => n.id === suggestion.targetNoteId)
    const [title, setTitle] = useState(String(payload['title'] ?? target?.title ?? ''))
    const [content, setContent] = useState(String(payload['content'] ?? ''))
    const [category, setCategory] = useState(String(payload['category'] ?? target?.category ?? 'Unsorted'))
    const [contextMode, setContextMode] = useState(String(payload['context_mode'] ?? target?.contextMode ?? 'relevant'))
    const showBefore = suggestion.actionType !== 'create' && target
    return (
      <div className="block">
        {showBefore ? (
          <>
            <Eyebrow>Current version</Eyebrow>
            <p className="body-text" style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto' }}>
              {target!.content || '(empty)'}
            </p>
            <Rule end={50} />
            <Eyebrow>{suggestion.actionType === 'append' ? 'Proposed append' : 'Proposed replacement'}</Eyebrow>
          </>
        ) : null}
        <Field label="Title" value={title} onChange={setTitle} />
        <Field label="Proposed text" value={content} onChange={setContent} lines={12} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <SelectRow label="Category" value={category} options={NOTE_CATEGORIES.map((c) => ({ value: c, label: c }))} onChange={setCategory} />
          <SelectRow
            label="Assistant context"
            value={contextMode}
            options={[
              { value: 'always', label: 'Always included' },
              { value: 'relevant', label: 'When relevant' },
              { value: 'excluded', label: 'Excluded from chat' }
            ]}
            onChange={setContextMode}
          />
        </div>
        <div className="overlay-actions">
          <TextAction
            onClick={async () => {
              await approve(suggestion, {
                title,
                content,
                category,
                contextMode,
                isPinned: Boolean(payload['is_pinned'] ?? target?.isPinned ?? false)
              })
              close()
            }}
          >
            Approve change →
          </TextAction>
          <TextAction
            kind="destructive"
            onClick={async () => {
              await call('notes:rejectSuggestion', suggestion.id)
              refreshChat()
              close()
            }}
          >
            Reject
          </TextAction>
        </div>
      </div>
    )
  }

  function ChatTurn({ message, isLast }: { message: NoteChatMessage; isLast: boolean }): React.JSX.Element {
    const suggestions = useIpcQuery('notesChat:suggestions', message.id)
    const isUser = message.role === 'user'
    const content = isUser ? message.content : linkNoteReferences(message.content, ctl.notes)
    return (
      <div style={{ display: 'flex', gap: 14, paddingLeft: isUser ? 24 : 0 }}>
        {isUser ? <VRule /> : null}
        <div className="block" style={{ gap: 4, flex: 1 }}>
          <span style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
            <span
              className="display"
              style={{ fontSize: isUser ? '1rem' : '1.2rem', color: isUser ? 'var(--muted)' : 'var(--text-1)' }}
            >
              {isUser ? 'You' : 'Writing assistant'}
            </span>
            {!isUser ? (
              <span style={{ display: 'flex', gap: 12 }}>
                {isLast ? (
                  <button
                    type="button"
                    className="text-action text-action--secondary"
                    onClick={regenerate}
                    title="Regenerate the latest assistant response"
                  >
                    Regenerate
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-action text-action--destructive"
                  onClick={async () => {
                    await call('notesChat:deleteMessage', message.id)
                    refreshChat()
                  }}
                >
                  Delete response
                </button>
              </span>
            ) : null}
          </span>
          <div className="body-text chat-prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) =>
                  href?.startsWith('app-note://') ? (
                    <a
                      href={href}
                      onClick={(e) => {
                        e.preventDefault()
                        openNoteLink(href)
                      }}
                    >
                      {children}
                    </a>
                  ) : (
                    <a href={href} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  )
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
          {!isUser
            ? (suggestions.data ?? []).map((s) => <ProposalCard key={s.id} suggestion={s} />)
            : null}
        </div>
      </div>
    )
  }

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id

  return (
    <Screen
      back={{ label: worldQuery.data?.name ?? 'World', to: `/world/${worldId}/notes-list` }}
      rightActions={
        <>
          <TextAction kind="secondary" onClick={() => newNote('Unsorted')}>
            New note
          </TextAction>
          <TextAction kind="secondary" onClick={reviewAll}>
            Review proposals
          </TextAction>
          <TextAction
            kind="destructive"
            onClick={() =>
              overlay.open({
                eyebrow: 'Confirm',
                title: 'Clear this conversation?',
                render: (close) => (
                  <Confirm
                    body="Canonical notes remain. The transcript and unapproved workspace proposals will be removed."
                    actionLabel="Clear the conversation"
                    close={close}
                    onConfirm={async () => {
                      await call('notesChat:clear', worldId)
                      refreshChat()
                    }}
                  />
                )
              })
            }
          >
            Clear conversation
          </TextAction>
        </>
      }
    >
      <div>
        <h1 className="display" style={{ fontSize: 'var(--size-display-m)' }}>
          {worldQuery.data?.name ?? '…'} stays private here.
        </h1>
        <p className="body-text" style={{ maxWidth: 560 }}>
          Develop the world beside the conversation; only the context named below reaches this
          assistant. Nothing here is sent with scene prompts.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-6)', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 7, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
          <div
            ref={chatRef}
            style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', paddingRight: 8, minHeight: 160 }}
          >
            {messages.map((m) => (
              <ChatTurn key={m.id} message={m} isLast={m.id === lastAssistantId} />
            ))}
            {stream.streamText !== null ? (
              <div className="block" style={{ gap: 4 }}>
                <span style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                  <span className="display" style={{ fontSize: '1.2rem' }}>Writing assistant</span>
                  <PulseDot label="thinking" />
                </span>
                <div className="body-text chat-prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{stream.streamText + ' ▌'}</ReactMarkdown>
                </div>
              </div>
            ) : null}
            {messages.length === 0 && chatQuery.isSuccess && stream.streamText === null ? (
              <p className="body-text">Ask the writing assistant anything about this world.</p>
            ) : null}
          </div>

          <Rule end={78} />
          <div className="field">
            <textarea
              rows={2}
              value={draft}
              placeholder="Develop the world…"
              aria-label="Ask the writing assistant"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'baseline', flexWrap: 'wrap' }}>
            {stream.busy ? (
              <TextAction size={22} onClick={stream.cancel}>
                Stop →
              </TextAction>
            ) : (
              <TextAction size={22} onClick={send}>
                Ask →
              </TextAction>
            )}
            <span className="caption">
              {contextCount === 0 ? 'No notes in context' : `${contextCount} notes in context`}
            </span>
            <TextAction kind="secondary" onClick={reviewContext}>
              Review context
            </TextAction>
            <span className="caption">Ctrl+K finds a note</span>
          </div>
        </div>

        <VRule />

        <div style={{ flex: 5, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
          <NoteBrowser ctl={ctl} onNewNote={newNote} />
          {ctl.current ? (
            <>
              <Rule end={66} />
              <NoteEditor
                ctl={ctl}
                note={ctl.current}
                lines={8}
                onFocusMode={() =>
                  overlay.open({
                    eyebrow: 'Focus editor',
                    title: ctl.current!.title || 'Untitled',
                    render: () => <NoteEditor ctl={ctl} note={ctl.current!} lines={16} />
                  })
                }
              />
            </>
          ) : null}
        </div>
      </div>
    </Screen>
  )
}
