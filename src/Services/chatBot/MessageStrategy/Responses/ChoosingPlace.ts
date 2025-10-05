import { ResponseContract } from '../ResponseContract'
import * as Messages from '../../Messages'
import { WpMessage } from '../../../../Types/WpMessage'
import { MessagesEnum } from '../../MessagesEnum'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import { SessionStatuses } from '../../../../Types/SessionStatuses'
import { PlaceSuggestionHelper } from '../../PlaceSuggestionHelper'
import { PlaceOption } from '../../../../Interfaces/PlaceOption'

export class ChoosingPlace extends ResponseContract {
  public messageSupported: Array<string> = [
    MessageTypes.TEXT,
    MessageTypes.INTERACTIVE,
  ]

  public async processMessage(message: WpMessage): Promise<void> {
    console.log('🚀 ChoosingPlace.processMessage called with:', {
      messageType: message.type,
      messageText: message.msg,
      sessionId: this.session.id,
      sessionStatus: this.session.status,
      hasPlaceOptions: !!this.session.placeOptions,
      placeOptionsLength: this.session.placeOptions?.length || 0
    })

    const placeOptions = this.session.placeOptions
    if (!placeOptions || placeOptions.length === 0) {
      console.log('❌ No placeOptions found - redirecting to ASKING_FOR_PLACE')
      // Si no hay datos, volver a preguntar por el lugar
      await this.session.setStatus(SessionStatuses.ASKING_FOR_PLACE)
      const msg = Messages.askForLocation(this.currentClient.name)
      await this.sendMessage(msg)
      return
    }

    console.log('📋 PlaceOptions details:', {
      placeOptions: placeOptions.map(opt => ({
        option: opt.option,
        placeId: opt.placeId,
        isConfirmation: opt.placeId.startsWith('confirm:')
      }))
    })

    // Check if this is a confirmation scenario (has option 0 with confirm: prefix)
    const confirmationOption = placeOptions.find(opt => opt.option === 0 && opt.placeId.startsWith('confirm:'))
    const isConfirmationMode = !!confirmationOption

    const isFromButton = message.type === MessageTypes.INTERACTIVE && !!message.interactiveReply

    // Get the interactive reply ID (could be from button or list)
    let interactiveReplyId = ''
    if (isFromButton && message.interactiveReply) {
      console.log('🔍 Interactive Reply Debug:', {
        type: message.interactiveReply.type,
        button_reply: message.interactiveReply.button_reply,
        list_reply: message.interactiveReply.list_reply
      })

      if (message.interactiveReply.button_reply?.id) {
        interactiveReplyId = message.interactiveReply.button_reply.id
        console.log('📱 Using button reply ID:', interactiveReplyId)
      } else if (message.interactiveReply.list_reply?.id) {
        interactiveReplyId = message.interactiveReply.list_reply.id
        console.log('📋 Using list reply ID:', interactiveReplyId)
      }
    }

    if (isConfirmationMode) {
      await this.handleConfirmationResponse(message, isFromButton, interactiveReplyId, placeOptions)
    } else {
      await this.handleSuggestionSelection(message, isFromButton, interactiveReplyId, placeOptions)
    }
  }

  /**
   * Handles user response when confirming or rejecting a specific place
   */
  private async handleConfirmationResponse(
    message: WpMessage,
    isFromButton: boolean,
    interactiveReplyId: string,
    placeOptions: PlaceOption[]
  ): Promise<void> {
    // Get the candidate place ID from option 0
    const confirmationOption = placeOptions.find(opt => opt.option === 0 && opt.placeId.startsWith('confirm:'))
    if (!confirmationOption) {
      await this.askForLocationAgain()
      return
    }

    const candidatePlaceId = confirmationOption.placeId.replace('confirm:', '')
    const candidatePlace = await this.store.findPlaceById(candidatePlaceId)

    if (!candidatePlace) {
      await this.askForLocationAgain()
      return
    }

    // Get suggestions from other options (option > 0)
    const suggestionOptions = placeOptions.filter(opt => opt.option > 0)

    const userSelection = this.parseConfirmationFromOptions(
      isFromButton ? interactiveReplyId : message.msg,
      placeOptions,
      isFromButton
    )

    console.log('🔍 Confirmation Debug:', {
      confirmationValue: userSelection.confirmationValue,
      candidatePlace: candidatePlace?.name,
      userSelection
    })

    if (userSelection.confirmationValue !== null) {
      if (userSelection.confirmationValue) {
        console.log('✅ User confirmed place:', candidatePlace.name)
        await this.sendMessage(Messages.requestingService(candidatePlace.name)).then(async () => {
          await this.session.setStatus(SessionStatuses.ASKING_FOR_COMMENT)
          await this.session.setPlace(candidatePlace)
        })
      } else {
        // User said NO, show suggestions if available
        if (suggestionOptions && suggestionOptions.length > 0) {
          // Get actual place data for suggestions
          const suggestions: Array<{ id: string, name: string }> = []
          for (const option of suggestionOptions) {
            const place = await this.store.findPlaceById(option.placeId)
            if (place) {
              suggestions.push({ id: place.id, name: place.name })
            }
          }

          if (suggestions.length > 0) {
            const wpClient = this.store.wpClients[this.session.wp_client_id]
            const suggestionMessage = PlaceSuggestionHelper.createSuggestionMessage(
              suggestions.map((suggestion, index) => ({
                option: index + 1,
                placeId: suggestion.id,
                placeName: suggestion.name
              })),
              candidatePlace.name,
              wpClient?.service,
              { id: this.session.id }
            )
            await this.sendMessage(suggestionMessage).then(async () => {
              // Store suggestions as individual PlaceOption entries
              const newPlaceOptions: PlaceOption[] = suggestions.map((suggestion, index) => ({
                option: index + 1,
                placeId: suggestion.id
              }))
              await this.session.setPlaceOptions(newPlaceOptions)
            })
          } else {
            await this.askForLocationAgain()
          }
        } else {
          await this.askForLocationAgain()
        }
      }
    } else {
      console.log('❌ Response not recognized as confirmation, asking for clarification')
      console.log('User input was:', userSelection)
      await this.askForClarification()
    }
  }

  /**
   * Handles user selection from suggestion list
   */
  private async handleSuggestionSelection(
    message: WpMessage,
    isFromButton: boolean,
    interactiveReplyId: string,
    placeOptions: PlaceOption[]
  ): Promise<void> {
    // Convert PlaceOption entries to suggestion format for parseUserSelection
    // Sort by option number to ensure correct order for numbered selection
    const sortedPlaceOptions = placeOptions
      .filter(opt => opt.option > 0) // Exclude confirmation options (option 0)
      .sort((a, b) => a.option - b.option)

    console.log('🔍 Converting PlaceOptions to suggestions:', {
      placeOptionsCount: placeOptions.length,
      sortedOptionsCount: sortedPlaceOptions.length,
      placeOptions: placeOptions.map(opt => ({ option: opt.option, placeId: opt.placeId })),
      sortedOptions: sortedPlaceOptions.map(opt => ({ option: opt.option, placeId: opt.placeId }))
    })

    const suggestions: Array<{ id: string, name: string }> = []

    for (const option of sortedPlaceOptions) {
      const place = await this.store.findPlaceById(option.placeId)
      if (place) {
        suggestions.push({ id: place.id, name: place.name })
        console.log(`✅ Found place for option ${option.option}:`, place.name)
      } else {
        console.log(`❌ No place found for option ${option.option} with ID:`, option.placeId)
      }
    }

    console.log('🔍 Final suggestions array:', {
      suggestionsCount: suggestions.length,
      suggestions: suggestions.map((s, index) => `${index + 1}. ${s.name}`)
    })

    const userSelection = this.parseUserSelectionFromOptions(
      isFromButton ? interactiveReplyId : message.msg,
      sortedPlaceOptions,
      isFromButton
    )

    console.log('🔍 ChoosingPlace Selection Debug:', {
      userMessage: message.msg,
      interactiveReplyId,
      isFromButton,
      userSelection,
      placeOptionsCount: sortedPlaceOptions.length
    })

    if (userSelection.selectedPlaceId) {
      console.log('🎯 Processing selected place ID:', userSelection.selectedPlaceId)
      const selectedPlace = await this.store.findPlaceById(userSelection.selectedPlaceId)
      if (selectedPlace) {
        console.log('✅ Found selected place:', selectedPlace.name)
        await this.sendMessage(Messages.requestingService(selectedPlace.name)).then(async () => {
          await this.session.setStatus(SessionStatuses.ASKING_FOR_COMMENT)
          await this.session.setPlace(selectedPlace)
        })
      } else {
        console.log('❌ Selected place not found in database')
        await this.askForLocationAgain()
      }
    } else if (userSelection.isNone) {
      console.log('🎯 User selected NONE option - asking for location again')
      await this.askForLocationAgain()
    } else {
      console.log('❌ Unrecognized selection, asking for clarification')
      console.log('Selection details:', {
        selectedPlaceId: userSelection.selectedPlaceId,
        isNone: userSelection.isNone
      })
      await this.askForClarification()
    }
  }

  /**
   * Parses confirmation responses (Yes/No) directly from PlaceOptions
   */
  private parseConfirmationFromOptions(
    userInput: string,
    placeOptions: PlaceOption[],
    isFromButton: boolean
  ): { confirmationValue: boolean | null } {
    console.log('🔍 Parsing confirmation:', {
      userInput,
      isFromButton
    })

    if (isFromButton) {
      if (userInput === '1') {
        console.log('✅ Button confirmation: YES (1)')
        return { confirmationValue: true }
      }
      if (userInput === '2') {
        console.log('✅ Button confirmation: NO (2)')
        return { confirmationValue: false }
      }
    } else {
      const numberMatch = userInput.trim().match(/^(\d+)$/)
      if (numberMatch) {
        const number = parseInt(numberMatch[1])
        if (number === 1) {
          console.log('✅ Text confirmation: YES (1)')
          return { confirmationValue: true }
        }
        if (number === 2) {
          console.log('✅ Text confirmation: NO (2)')
          return { confirmationValue: false }
        }
      }
    }

    console.log('❌ Confirmation not recognized')
    return { confirmationValue: null }
  }

  /**
   * Parses user selection directly from PlaceOptions (much simpler and more reliable)
   */
  private parseUserSelectionFromOptions(
    userInput: string,
    placeOptions: PlaceOption[],
    isFromButton: boolean
  ): { selectedPlaceId: string | null, isNone: boolean } {
    console.log('🔍 Parsing selection from options:', {
      userInput,
      isFromButton,
      optionsCount: placeOptions.length
    })

    if (isFromButton) {
      // For buttons/lists, check for "none" selection
      if (userInput === 'none') {
        console.log('✅ Button selection: NONE')
        return { selectedPlaceId: null, isNone: true }
      }

      // Parse direct option number
      const optionNumber = parseInt(userInput)
      if (!isNaN(optionNumber)) {
        console.log('✅ Button selection: PlaceOption', optionNumber)

        // Find PlaceOption with matching option number
        const selectedOption = placeOptions.find(opt => opt.option === optionNumber)
        if (selectedOption) {
          console.log('✅ Found PlaceOption:', selectedOption)
          return { selectedPlaceId: selectedOption.placeId, isNone: false }
        }
      }

      console.log('❌ Button ID not recognized')
      return { selectedPlaceId: null, isNone: false }
    } else {
      // For text input, map number directly to PlaceOption
      const numberMatch = userInput.trim().match(/^(\d+)$/)
      if (numberMatch) {
        const number = parseInt(numberMatch[1])
        console.log('🔢 Text number detected:', number)

        // Find PlaceOption with matching option number
        const selectedOption = placeOptions.find(opt => opt.option === number)
        if (selectedOption) {
          if (selectedOption.placeId === 'none') {
            console.log('✅ Text selection: NONE')
            return { selectedPlaceId: null, isNone: true }
          } else {
            console.log('✅ Text selection: Place ID', selectedOption.placeId)
            return { selectedPlaceId: selectedOption.placeId, isNone: false }
          }
        }

        // Check if it's the "none" option (last number)
        const maxOption = Math.max(...placeOptions.map(opt => opt.option))
        if (number === maxOption + 1) {
          console.log('✅ Text selection: NONE (calculated)')
          return { selectedPlaceId: null, isNone: true }
        }
      }

      console.log('❌ Text input not recognized')
      return { selectedPlaceId: null, isNone: false }
    }
  }

  /**
   * Ask for location again
   */
  private async askForLocationAgain(): Promise<void> {
    await this.session.setStatus(SessionStatuses.ASKING_FOR_PLACE)
    await this.session.setPlaceOptions([])
    const msg = Messages.askForLocation(this.currentClient.name)
    await this.sendMessage(msg)
  }

  /**
   * Ask for clarification when response is not recognized
   */
  private async askForClarification(): Promise<void> {
    const wpClient = this.store.wpClients[this.session.wp_client_id]
    const isApiOfficial = wpClient?.service === 'api-official'

    let clarificationText: string
    if (isApiOfficial) {
      clarificationText = 'Por favor selecciona una de las opciones usando los botones.'
    } else {
      clarificationText = 'Por favor responde con el número de la opción que prefieres (ej: 1, 2, 3, etc.)'
    }

    const clarificationMessage = {
      id: 'place_clarification',
      name: 'Selection Clarification',
      description: 'Ask for clarification about selection',
      message: clarificationText,
      enabled: true,
      interactive: null
    }

    await this.sendMessage(clarificationMessage)
  }
}
