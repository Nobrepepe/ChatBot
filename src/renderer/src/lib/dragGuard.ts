/**
 * Dragging a text selection is the only drag this app offers, and there is
 * nowhere in it to drop one — every screen is prose and text actions, and the
 * art is already `draggable={false}`.
 *
 * On KDE Plasma 6 under Wayland, starting that drag can leave the window
 * rendering happily but deaf to every click: the drag loop never ends, so the
 * only thing that still answers the pointer is whatever scroll region it
 * happens to be over (electron/electron#49907, closed as not planned). It is
 * not ours to fix, but it is ours not to trigger.
 *
 * So a drag never starts outside the fields where dropping text means
 * something — the composer, the editors, the note bodies. Selecting, copying
 * and dragging within a textarea all behave exactly as they did.
 */
export function installDragGuard(target: Document = document): () => void {
  const onDragStart = (event: DragEvent): void => {
    const from = event.target
    const element = from instanceof Element ? from : ((from as Node | null)?.parentElement ?? null)
    if (element?.closest('input, textarea, [contenteditable="true"]')) return
    event.preventDefault()
  }
  target.addEventListener('dragstart', onDragStart, true)
  return () => target.removeEventListener('dragstart', onDragStart, true)
}
