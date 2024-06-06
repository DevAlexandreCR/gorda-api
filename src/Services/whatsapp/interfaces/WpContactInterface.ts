export interface WpContactInterface {
  pushname: string
  number: any
  id: {
    _serialized: string
  }

  getProfilePicUrl(): string | PromiseLike<string>
}
