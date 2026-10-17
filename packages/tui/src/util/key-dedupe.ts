import { performance } from "perf_hooks"
import type { CliRenderer } from "@opentui/core"

// One physical keypress can occasionally surface as two identical key events
// from the stdin layer; specific terminal emulator versions and the Bun/Node
// event loop have both been at fault for this class of bug (opencode issue
// #4920). The duplicate arrives within a few milliseconds of the original —
// faster than OS key auto-repeat (no mainstream platform repeats under ~15ms,
// and kitty-protocol repeats carry a different raw sequence anyway) and faster
// than any human double press.
//
// The guard therefore drops an identical raw key sequence that reappears
// within the window from a *fresh* event-loop turn. Sequences produced inside
// the same synchronous stdin read are accepted instead, so bulk text without
// bracketed-paste mode (which surfaces as a burst of key events from one
// read) keeps all of its characters, including consecutive repeats.

const DUPLICATE_WINDOW_MS = 6

// Raw sequences can also be terminal responses and mouse reports, which are
// dispatched through the same input handlers and may legitimately repeat.
// Never treat those as key duplicates. Kitty key events end in "u", "~" or an
// uppercase letter, so none of these final bytes collide with a key.
function isResponseLike(sequence: string) {
  if (sequence.startsWith("\x1b_G") || sequence.startsWith("\x1b[M")) return true
  return /^\x1b\[[?><0-9;:]*[RcnMmt]$/.test(sequence)
}

export function createDuplicateKeyGuard(): (sequence: string) => boolean {
  let lastSequence: string | undefined
  let lastAcceptedAt = 0
  // Microtasks do not run while one synchronous stdin read drains its events,
  // so a queued reset still pending when the next event arrives means both
  // events came from the same read.
  let sameRead = true
  let resetQueued = false

  const scheduleReset = () => {
    if (resetQueued) return
    resetQueued = true
    queueMicrotask(() => {
      resetQueued = false
      sameRead = false
    })
  }

  return (sequence) => {
    if (isResponseLike(sequence)) return false

    const at = performance.now()
    if (
      sequence === lastSequence &&
      !sameRead &&
      at - lastAcceptedAt < DUPLICATE_WINDOW_MS
    ) {
      // Keep the anchor on the original event so a further duplicate from the
      // same press is dropped too.
      return true
    }

    lastSequence = sequence
    lastAcceptedAt = at
    scheduleReset()
    sameRead = true
    return false
  }
}

export function registerDuplicateKeyGuard(renderer: CliRenderer) {
  if (process.env.OPENCODE_DISABLE_KEY_DEDUPE) return
  renderer.prependInputHandler(createDuplicateKeyGuard())
}
