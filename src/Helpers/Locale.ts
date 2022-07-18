import {I18n} from 'i18n'
import path from 'path'

export class Locale {
  static instance: Locale;
  public i18n: I18n
  
  private constructor() {
    this.i18n = new I18n
    this.i18n.configure({
      locales: ['en', 'es'],
      directory: path.join(__dirname, '../locales'),
      defaultLocale: 'es',
      objectNotation: true,
      register: global
    })
  }
  
  public static getInstance(): Locale {
    if (!Locale.instance) {
      Locale.instance = new Locale();
    }
    return Locale.instance;
  }
  
  public __(key: string): string {
    return this.i18n.__(key)
  }
}