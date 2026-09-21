import { WpMessageAdapter } from '../WPMessageAdapter'
import { MessageTypes } from '../../../../constants/MessageTypes'
import { WASocket } from '@whiskeysockets/baileys'

const fakeSocket = {} as WASocket
const FROM = '573001234567@c.us'

function waMessage(message: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    key: { id: 'WAMID1', remoteJid: '573001234567@s.whatsapp.net' },
    messageTimestamp: 1700000000,
    message,
    ...overrides,
  } as any
}

describe('WpMessageAdapter (spec: wp-inbound-message-normalization - Baileys recognizes wrapped, extended and interactive inbound messages)', () => {
  it('unwraps ephemeralMessage and reads extendedTextMessage as TEXT (Quoted reply in a disappearing-messages chat)', () => {
    const adapter = new WpMessageAdapter(
      waMessage({
        ephemeralMessage: { message: { extendedTextMessage: { text: 'Cuánto vale el viaje?' } } },
      }),
      fakeSocket,
      FROM
    )

    expect(adapter.type).toBe(MessageTypes.TEXT)
    expect(adapter.body).toBe('Cuánto vale el viaje?')
  })

  it('reads a plain extendedTextMessage as TEXT (Plain text delivered as extended text)', () => {
    const adapter = new WpMessageAdapter(
      waMessage({ extendedTextMessage: { text: 'Hola' } }),
      fakeSocket,
      FROM
    )

    expect(adapter.type).toBe(MessageTypes.TEXT)
    expect(adapter.body).toBe('Hola')
  })

  it('reads a plain conversation as TEXT', () => {
    const adapter = new WpMessageAdapter(
      waMessage({ conversation: 'Hola directo' }),
      fakeSocket,
      FROM
    )

    expect(adapter.type).toBe(MessageTypes.TEXT)
    expect(adapter.body).toBe('Hola directo')
  })

  it('unwraps a wrapper nested around another wrapper (viewOnceMessage inside ephemeralMessage)', () => {
    const adapter = new WpMessageAdapter(
      waMessage({
        ephemeralMessage: {
          message: { viewOnceMessage: { message: { conversation: 'Doble envoltura' } } },
        },
      }),
      fakeSocket,
      FROM
    )

    expect(adapter.type).toBe(MessageTypes.TEXT)
    expect(adapter.body).toBe('Doble envoltura')
  })

  it('reads locationMessage as LOCATION', () => {
    const adapter = new WpMessageAdapter(
      waMessage({
        locationMessage: { degreesLatitude: 4.65, degreesLongitude: -74.05, name: 'Bogotá' },
      }),
      fakeSocket,
      FROM
    )

    expect(adapter.type).toBe(MessageTypes.LOCATION)
    expect(adapter.location).toEqual({ lat: 4.65, lng: -74.05, name: 'Bogotá' })
  })

  it('unwraps viewOnceMessageV2 and reads the location it carries', () => {
    const adapter = new WpMessageAdapter(
      waMessage({
        viewOnceMessageV2: {
          message: { locationMessage: { degreesLatitude: 1, degreesLongitude: 2, name: 'X' } },
        },
      }),
      fakeSocket,
      FROM
    )

    expect(adapter.type).toBe(MessageTypes.LOCATION)
    expect(adapter.location).toEqual({ lat: 1, lng: 2, name: 'X' })
  })

  it('reads buttonsResponseMessage as INTERACTIVE with a button_reply', () => {
    const adapter = new WpMessageAdapter(
      waMessage({ buttonsResponseMessage: { selectedButtonId: 'CANCEL' } }),
      fakeSocket,
      FROM
    )

    expect(adapter.type).toBe(MessageTypes.INTERACTIVE)
    expect(adapter.interactiveReply).toEqual({
      type: 'button_reply',
      button_reply: { id: 'CANCEL', title: '' },
    })
    expect(adapter.body).toBe('CANCEL')
  })

  it('reads listResponseMessage as INTERACTIVE with a list_reply (Native list reply)', () => {
    const adapter = new WpMessageAdapter(
      waMessage({
        listResponseMessage: { singleSelectReply: { selectedRowId: 'INSIST' } },
      }),
      fakeSocket,
      FROM
    )

    expect(adapter.type).toBe(MessageTypes.INTERACTIVE)
    expect(adapter.interactiveReply).toEqual({
      type: 'list_reply',
      list_reply: { id: 'INSIST', title: '' },
    })
  })

  it('reads templateButtonReplyMessage as INTERACTIVE with a button_reply', () => {
    const adapter = new WpMessageAdapter(
      waMessage({ templateButtonReplyMessage: { selectedId: 'TPL_OK' } }),
      fakeSocket,
      FROM
    )

    expect(adapter.type).toBe(MessageTypes.INTERACTIVE)
    expect(adapter.interactiveReply).toEqual({
      type: 'button_reply',
      button_reply: { id: 'TPL_OK', title: '' },
    })
  })

  it('reads interactiveResponseMessage as INTERACTIVE with a button_reply from the native flow params', () => {
    const adapter = new WpMessageAdapter(
      waMessage({
        interactiveResponseMessage: {
          nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id: 'FLOW_YES' }) },
        },
      }),
      fakeSocket,
      FROM
    )

    expect(adapter.type).toBe(MessageTypes.INTERACTIVE)
    expect(adapter.interactiveReply).toEqual({
      type: 'button_reply',
      button_reply: { id: 'FLOW_YES', title: '' },
    })
  })

  it('leaves an unrecognized shape as UNKNOWN with an empty body', () => {
    const adapter = new WpMessageAdapter(waMessage({ stickerMessage: {} }), fakeSocket, FROM)

    expect(adapter.type).toBe(MessageTypes.UNKNOWN)
    expect(adapter.body).toBe('')
    expect(adapter.interactiveReply).toBeNull()
  })

  it('converts a Long messageTimestamp to a finite number of seconds (Long timestamp)', () => {
    const longTimestamp = { toNumber: () => 1700000123 }
    const adapter = new WpMessageAdapter(
      waMessage({ conversation: 'hola' }, { messageTimestamp: longTimestamp }),
      fakeSocket,
      FROM
    )

    expect(adapter.timestamp).toBe(1700000123)
    expect(Number.isFinite(adapter.timestamp)).toBe(true)
  })

  it('converts a plain numeric messageTimestamp unchanged', () => {
    const adapter = new WpMessageAdapter(
      waMessage({ conversation: 'hola' }, { messageTimestamp: 1699999999 }),
      fakeSocket,
      FROM
    )

    expect(adapter.timestamp).toBe(1699999999)
  })

  it('stores id, from and isStatus from the raw message', () => {
    const adapter = new WpMessageAdapter(
      waMessage({ conversation: 'hola' }, { broadcast: true }),
      fakeSocket,
      FROM
    )

    expect(adapter.id).toBe('WAMID1')
    expect(adapter.from).toBe(FROM)
    expect(adapter.isStatus).toBe(true)
  })
})
