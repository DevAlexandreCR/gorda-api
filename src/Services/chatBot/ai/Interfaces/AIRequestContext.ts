export interface AIRequestContext {
  known: {
    name: string | null
    place: string | null
  }
  history: {
    role: 'user' | 'assistant'
    text: string
  }[]
}
