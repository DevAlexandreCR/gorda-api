import { renderInteractiveAsText } from '../renderInteractiveAsText'
import { ChatBotMessage } from '../../../../Types/ChatBotMessage'
import { buildCandidateListInteractive } from '../../../chatBot/agent/CandidateListMessage'
import { AgentToolCandidate } from '../../../chatBot/agent/AgentTools'

function baseMessage(overrides: Partial<ChatBotMessage> = {}): ChatBotMessage {
  return {
    id: 'msg-1',
    name: 'test',
    description: 'test',
    message: 'Seguimos buscando conductor.',
    enabled: true,
    interactive: null,
    ...overrides,
  }
}

describe('renderInteractiveAsText (spec: wp-interactive-fallback - Interactive catalog messages render as numbered text on Baileys)', () => {
  it('Reply buttons: renders body, a blank line, and one numbered line per button', () => {
    const message = baseMessage({
      interactive: {
        type: 'button',
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'CANCEL', title: 'Cancelar' } },
            { type: 'reply', reply: { id: 'INSIST', title: 'Insistir' } },
          ],
        },
      },
    })

    expect(renderInteractiveAsText(message)).toBe(
      'Seguimos buscando conductor.\n\n1. Cancelar\n2. Insistir'
    )
  })

  it('List with two sections: numbers rows 1-3 across sections, keeps section titles before rows, and appends the row description', () => {
    const message = baseMessage({
      message: 'Elige una opcion',
      interactive: {
        type: 'list',
        action: {
          button: 'Ver opciones',
          sections: [
            {
              title: 'Seccion 1',
              rows: [
                { id: 'A', title: 'Fila A', description: 'Descripcion A' },
                { id: 'B', title: 'Fila B' },
              ],
            },
            {
              title: 'Seccion 2',
              rows: [{ id: 'C', title: 'Fila C' }],
            },
          ],
        },
      },
    })

    expect(renderInteractiveAsText(message)).toBe(
      [
        'Elige una opcion',
        '',
        'Seccion 1',
        '1. Fila A - Descripcion A',
        '2. Fila B',
        'Seccion 2',
        '3. Fila C',
      ].join('\n')
    )
  })

  it('Location request: sends the body text only', () => {
    const message = baseMessage({
      message: 'Comparte tu ubicacion, por favor',
      interactive: {
        type: 'location_request_message',
        body: { text: 'Comparte tu ubicacion, por favor' },
        action: {},
      },
    })

    expect(renderInteractiveAsText(message)).toBe('Comparte tu ubicacion, por favor')
  })

  it('Plain text: body is unchanged when interactive is null', () => {
    const message = baseMessage({ message: 'Hola, como estas?', interactive: null })

    expect(renderInteractiveAsText(message)).toBe('Hola, como estas?')
  })

  // Candidate list (chatbot-agent-conversation follow-up): CandidateListMessage's
  // escape row must number like any other row, since resolveInteractiveOption's
  // ordinal matching (design D4) mirrors this same numbering.
  it('Candidate list: numbers place rows and the "Ninguno de estos" escape row last', () => {
    const candidates: AgentToolCandidate[] = [
      { id: 'p1', name: 'Studio F Campanario', score: 1 },
      { id: 'p2', name: 'CLARO CAMPANARIO', score: 1 },
      { id: 'p3', name: 'CINES CAMPANARIO', score: 1 },
    ]
    const message = baseMessage({
      message: 'Encontré varios puntos en Campanario, ¿en cuál te recogemos?',
      interactive: buildCandidateListInteractive(
        'Encontré varios puntos en Campanario, ¿en cuál te recogemos?',
        candidates
      ),
    })

    expect(renderInteractiveAsText(message)).toBe(
      [
        'Encontré varios puntos en Campanario, ¿en cuál te recogemos?',
        '',
        '1. Studio F Campanario',
        '2. CLARO CAMPANARIO',
        '3. CINES CAMPANARIO',
        '4. Ninguno de estos',
      ].join('\n')
    )
  })

  it('includes header and footer text around the body and options when present', () => {
    const message = baseMessage({
      message: 'Cuerpo del mensaje',
      interactive: {
        type: 'button',
        header: { type: 'text', text: 'Encabezado' },
        footer: { text: 'Pie de pagina' },
        action: {
          buttons: [{ type: 'reply', reply: { id: 'CANCEL', title: 'Cancelar' } }],
        },
      },
    })

    expect(renderInteractiveAsText(message)).toBe(
      'Encabezado\nCuerpo del mensaje\n\n1. Cancelar\nPie de pagina'
    )
  })
})
