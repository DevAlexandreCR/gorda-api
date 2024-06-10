export interface WpContactInterface {
  pushname: string
  number: any
  id: string

  getProfilePicUrl(): string | PromiseLike<string>
}
