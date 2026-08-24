import { useState } from 'react'
import { MEMORY_TYPES, type MemoryProposal, type MemoryType } from '@shared/types'
import { Eyebrow, Rule, TextAction } from '../../components/primitives'
import { Field, SelectRow } from '../../components/fields'
import { useSnack } from '../../components/snack'
import { call } from '../../lib/api'

const ACTION_LABEL: Record<string, string> = {
  create: 'Remember',
  replace: 'Rewrite',
  forget: 'Forget'
}

const TYPE_LABEL: Record<MemoryType, string> = {
  canon: 'Canon · permanently true',
  relationship: 'Relationship · how they feel about you',
  session: 'Session · never sent to the model'
}

/**
 * The review surface for memory actions the model has proposed. It is the
 * notes workspace's proposal card applied to a memory: a rewrite shows what
 * the memory says today above what it would say, so the user can see that the
 * old fact is being replaced rather than duplicated.
 */
export function MemoryProposalList({
  proposals,
  onSettled
}: {
  proposals: MemoryProposal[]
  onSettled?: () => void
}): React.JSX.Element {
  if (proposals.length === 0) {
    return <p className="body-text">Nothing is waiting for review.</p>
  }
  return (
    <div className="block">
      <p className="body-text">
        Approved memories are sent with every future prompt for their character. A rewrite
        replaces what is there — nothing is duplicated.
      </p>
      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} onSettled={onSettled} />
      ))}
    </div>
  )
}

function ProposalCard({
  proposal,
  onSettled
}: {
  proposal: MemoryProposal
  onSettled?: () => void
}): React.JSX.Element {
  const { snack } = useSnack()
  const [resolved, setResolved] = useState<'approved' | 'rejected' | null>(null)
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState(proposal.proposedContent)
  const [type, setType] = useState<MemoryType>(proposal.memoryType)
  const forget = proposal.actionType === 'forget'

  async function approve(): Promise<void> {
    try {
      await call('memories:approveSuggestion', proposal.id, { content, type })
      setResolved('approved')
      onSettled?.()
    } catch (err) {
      snack((err as Error).message, true)
    }
  }

  async function reject(): Promise<void> {
    try {
      await call('memories:rejectSuggestion', proposal.id)
      setResolved('rejected')
      onSettled?.()
    } catch (err) {
      snack((err as Error).message, true)
    }
  }

  return (
    <div className="block" style={{ gap: 6 }}>
      <Eyebrow>
        {ACTION_LABEL[proposal.actionType] ?? proposal.actionType} · {proposal.characterName}
        {resolved ? ` · ${resolved}` : ''}
      </Eyebrow>

      {proposal.currentContent ? (
        <>
          <span className="caption">Currently</span>
          <p className="body-text" style={{ color: 'var(--muted-2)' }}>
            {proposal.currentContent}
          </p>
          {!forget ? <span className="caption">Would become</span> : null}
        </>
      ) : null}

      {forget ? (
        <p className="caption">
          {String(proposal.payload['reason'] ?? 'It is no longer true.')} Approving removes it.
        </p>
      ) : open && !resolved ? (
        <>
          <Field label="" value={content} onChange={setContent} lines={3} autoFocus />
          <SelectRow
            label="Kind"
            value={type}
            options={MEMORY_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
            onChange={(v) => setType(v as MemoryType)}
          />
        </>
      ) : (
        <p className="body-text">{content}</p>
      )}

      {!resolved ? (
        <span style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          {forget ? (
            <TextAction kind="destructive" onClick={approve}>
              Forget it →
            </TextAction>
          ) : (
            <>
              <TextAction kind="secondary" onClick={approve}>
                Keep it →
              </TextAction>
              <TextAction kind="secondary" onClick={() => setOpen(!open)}>
                {open ? 'Done editing' : 'Edit first'}
              </TextAction>
            </>
          )}
          <TextAction kind="destructive" onClick={reject}>
            {forget ? 'Keep the memory' : 'Reject'}
          </TextAction>
        </span>
      ) : null}
      <Rule end={54 + ((proposal.id * 11) % 30)} />
    </div>
  )
}
