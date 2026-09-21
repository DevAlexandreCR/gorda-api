import { InteractiveReply } from '../services/Official/Constants/InteractiveReply'

// Design D10: the single place that decides "the id of whichever interactive reply this
// is" — button first, then list — so a list_reply can never again silently fall through
// to an empty id the way four hand-rolled `button_reply?.id` reads once did.
export function interactiveReplyId(reply: InteractiveReply | null | undefined): string | null {
  if (!reply) {
    return null
  }
  return reply.button_reply?.id ?? reply.list_reply?.id ?? null
}
