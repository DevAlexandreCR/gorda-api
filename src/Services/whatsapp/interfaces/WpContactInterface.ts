export interface WpContactInterface {
  pushname: string
  number: any
  id: {
    _serialized: string
  }
  name: string
  phoneNumber: string
  email?: string

  getProfilePicUrl(): string | PromiseLike<string>
}
