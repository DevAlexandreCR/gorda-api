import { RideFeeInterface } from '../Types/RideFeeInterface'
import SettingsRepository from '../Repositories/SettingsRepository'
import dayjs from 'dayjs'

export async function setDynamicMinFee(): Promise<void> {
  const fees: RideFeeInterface = await SettingsRepository.getFees()

  const now = dayjs().tz('America/Bogota')
  const isDay = now.hour() >= 6 && now.hour() < 18
  const isNigth = now.hour() >= 18 || now.hour() < 6
  const isSunday = now.day() === 0

  if (isSunday) {
    if (isDay) {
      console.log('Setting festive day fee', fees.fees_min_festive_day)
      await SettingsRepository.setMinFee(fees.fees_min_festive_day)
    } else if (isNigth) {
      console.log('Setting festive night fee', fees.fees_min_festive_nigth)
      await SettingsRepository.setMinFee(fees.fees_min_festive_nigth)
    }
  } else {
    if (isDay) {
      console.log('Setting day fee', fees.fees_min_day)
      await SettingsRepository.setMinFee(fees.fees_min_day)
    } else if (isNigth) {
      console.log('Setting night fee', fees.fees_min_nigth)
      await SettingsRepository.setMinFee(fees.fees_min_nigth)
    }
  }
}
