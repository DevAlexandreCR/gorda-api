import { interactiveReplyId } from '../interactiveReplyId'

describe('interactiveReplyId (design D10)', () => {
  it('returns the button_reply id when present', () => {
    expect(
      interactiveReplyId({
        type: 'button_reply',
        button_reply: { id: 'CANCEL', title: 'Cancelar' },
      })
    ).toBe('CANCEL')
  })

  it('returns the list_reply id when there is no button_reply', () => {
    expect(
      interactiveReplyId({
        type: 'list_reply',
        list_reply: { id: 'INSIST', title: 'Insistir' },
      })
    ).toBe('INSIST')
  })

  it('prefers button_reply over list_reply when both are present', () => {
    expect(
      interactiveReplyId({
        type: 'button_reply',
        button_reply: { id: 'BUTTON_ID', title: 'Button' },
        list_reply: { id: 'LIST_ID', title: 'List' },
      })
    ).toBe('BUTTON_ID')
  })

  it('returns null for null, undefined and an empty reply', () => {
    expect(interactiveReplyId(null)).toBeNull()
    expect(interactiveReplyId(undefined)).toBeNull()
    expect(interactiveReplyId({ type: 'product_reply' })).toBeNull()
  })
})
