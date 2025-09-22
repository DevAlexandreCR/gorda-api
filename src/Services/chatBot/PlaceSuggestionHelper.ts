import { ChatBotMessage } from '../../Types/ChatBotMessage'
import { Interactive } from '../whatsapp/services/Official/Constants/Interactive'
import { WpClients } from '../whatsapp/constants/WPClients'

export class PlaceSuggestionHelper {
  /**
   * Creates place suggestion message adapted to WhatsApp client type
   */
  static createSuggestionMessage(
    placeOptions: Array<{ option: number, placeId: string, placeName: string }>,
    originalQuery: string,
    wpClientService: WpClients,
    sessionData?: { id: string }
  ): ChatBotMessage {
    const isApiOfficial = wpClientService === WpClients.OFFICIAL

    if (isApiOfficial) {
      if (placeOptions.length > 2) {
        // Use list for more than 2 suggestions (up to 5)
        const limitedOptions = placeOptions.slice(0, 5)
        return this.createInteractiveListMessage(limitedOptions, originalQuery, sessionData)
      } else {
        // Use buttons for 1-2 suggestions
        return this.createInteractiveButtonMessage(placeOptions, originalQuery, sessionData)
      }
    } else {
      return this.createTextMessage(placeOptions, originalQuery)
    }
  }

  /**
   * Creates interactive message with buttons for official API (1-2 suggestions)
   */
  private static createInteractiveButtonMessage(
    placeOptions: Array<{ option: number, placeId: string, placeName: string }>,
    originalQuery: string,
    sessionData?: { id: string }
  ): ChatBotMessage {
    const interactive: Interactive = {
      type: 'button',
      body: {
        text: `No encontré exactamente "${originalQuery}". ¿Te refieres a alguno de estos lugares?`
      },
      action: {
        buttons: [
          ...placeOptions.map((placeOption) => ({
            type: 'reply' as const,
            reply: {
              id: placeOption.option.toString(),
              title: placeOption.placeName.length > 20 ? placeOption.placeName.substring(0, 17) + '...' : placeOption.placeName
            }
          })),
          {
            type: 'reply' as const,
            reply: {
              id: 'none',
              title: 'Ninguno de estos'
            }
          }
        ]
      },
      footer: {
        text: 'Selecciona una opción'
      }
    }

    return {
      id: 'place_suggestions_interactive',
      name: 'Place Suggestions (Interactive)',
      description: 'Interactive message with place suggestions',
      message: `No encontré exactamente "${originalQuery}". Por favor selecciona una opción:`,
      enabled: true,
      interactive
    }
  }

  /**
   * Creates interactive list message for multiple suggestions (3-5 options)
   */
  private static createInteractiveListMessage(
    placeOptions: Array<{ option: number, placeId: string, placeName: string }>,
    originalQuery: string,
    sessionData?: { id: string }
  ): ChatBotMessage {
    const interactive: Interactive = {
      type: 'list',
      body: {
        text: `No encontré exactamente "${originalQuery}". ¿Te refieres a alguno de estos lugares?`
      },
      action: {
        button: 'Seleccionar lugar',
        sections: [{
          title: 'Lugares encontrados',
          rows: [
            ...placeOptions.map((placeOption) => ({
              id: placeOption.option.toString(),
              title: placeOption.placeName.length > 20 ? placeOption.placeName.substring(0, 20) + '...' : placeOption.placeName,
              description: placeOption.placeName.length > 20 ? placeOption.placeName : undefined
            })),
            {
              id: 'none',
              title: 'Ninguna de estas',
              description: 'Buscar otro lugar'
            }
          ]
        }]
      },
      footer: {
        text: 'Selecciona una opción'
      }
    }

    return {
      id: 'place_suggestions_list',
      name: 'Place Suggestions (List)',
      description: 'Interactive list message with place suggestions',
      message: `No encontré exactamente "${originalQuery}". Por favor selecciona una opción:`,
      enabled: true,
      interactive
    }
  }

  /**
   * Creates text message for other client types
   */
  private static createTextMessage(
    placeOptions: Array<{ option: number, placeId: string, placeName: string }>,
    originalQuery: string
  ): ChatBotMessage {
    const limitedOptions = placeOptions.slice(0, 5)
    const suggestionList = limitedOptions
      .map((placeOption) => `${placeOption.option}. ${placeOption.placeName}`)
      .join('\n')

    const noneOptionNumber = limitedOptions.length + 1
    const message = `No encontré exactamente "${originalQuery}". ¿Te refieres a alguno de estos lugares?\n\n${suggestionList}\n\n${noneOptionNumber}. Ninguno de estos\n\nPor favor responde con el número del lugar correcto.`

    return {
      id: 'place_suggestions_text',
      name: 'Place Suggestions (Text)',
      description: 'Text message with place suggestions',
      message,
      enabled: true,
      interactive: null
    }
  }

  /**
   * Creates confirmation message for specific place
   */
  static createConfirmationMessage(
    placeName: string,
    wpClientService: WpClients,
    sessionData?: { id: string }
  ): ChatBotMessage {
    const isApiOfficial = wpClientService === WpClients.OFFICIAL

    if (isApiOfficial) {
      const interactive: Interactive = {
        type: 'button',
        body: {
          text: `¿Te refieres a "${placeName}"?`
        },
        action: {
          buttons: [
            {
              type: 'reply',
              reply: {
                id: '1',
                title: 'Sí, ese es'
              }
            },
            {
              type: 'reply',
              reply: {
                id: '2',
                title: 'No, otro lugar'
              }
            }
          ]
        },
        footer: {
          text: 'Confirma tu selección'
        }
      }

      return {
        id: 'place_confirmation_interactive',
        name: 'Place Confirmation (Interactive)',
        description: 'Interactive place confirmation message',
        message: `¿Te refieres a "${placeName}"?`,
        enabled: true,
        interactive
      }
    } else {
      return {
        id: 'place_confirmation_text',
        name: 'Place Confirmation (Text)',
        description: 'Text place confirmation message',
        message: `¿Te refieres a "${placeName}"?\n\n1. Sí, ese es\n2. No, otro lugar\n\nResponde con el número de tu elección.`,
        enabled: true,
        interactive: null
      }
    }
  }
}