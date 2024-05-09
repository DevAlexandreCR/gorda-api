export enum Placeholders {
  PLATE = '[[PLATE]]',
  COLOR = '[[COLOR]]',
  USERNAME = '[[USERNAME]]',
  PQR_NUMBER = '[[PQR-NUMBER]]',
  PLACE = '[[PLACE]]',
  COMPANY = '[[COMPANY]]',
}

export function replacePlaceholders(input: string, placeholders: Map<Placeholders, string>): string {
  let result = input
  placeholders.forEach((value, key) => {
    const regex = new RegExp('\'\\\\[\\\\[\' + key + \'\\\\]\\\\]\', \'g\'')
    result = result.replace(regex, value)
  })

  return result
}