import { RideFeeInterface } from '../Types/RideFeeInterface'
import SettingsRepository from '../Repositories/SettingsRepository'
import dayjs from 'dayjs'

export async function setDynamicMultiplierFee(): Promise<void> {
  const fees: RideFeeInterface = await SettingsRepository.getFees()

  const now = dayjs().tz('America/Bogota')
  const isDay = now.hour() >= 6 && now.hour() < 18
  const isNigth = now.hour() >= 18 || now.hour() < 6
  const isSunday = now.day() === 0
  let multiplier = 1

  if (isSunday) {
    if (isDay) {
      console.log('Setting festive day multiplier', fees.fees_DxF)
      multiplier = fees.fees_DxF
    } else if (isNigth) {
      console.log('Setting festive night multiplier', fees.fees_night_DxF)
      multiplier = fees.fees_night_DxF
    }
  } else {
    if (isDay) {
      console.log('Setting day multiplier', 1)
    } else if (isNigth) {
      console.log('Setting night multiplier', fees.fees_night)
      multiplier = fees.fees_night
    }
  }

  fees.dynamic_multipliers?.forEach(async (element) => {
    const today = now.format('YYYY-MM-DD')
    const start = dayjs.tz(
      `${today} ${element.timeRanges.start}`,
      'YYYY-MM-DD HH:mm',
      'America/Bogota'
    )
    const end = dayjs.tz(`${today} ${element.timeRanges.end}`, 'YYYY-MM-DD HH:mm', 'America/Bogota')

    if (now.isAfter(start) && now.isBefore(end)) {
      console.log('Setting dynamic multiplier', element.multiplier)
      multiplier = element.multiplier
    }
  })

  console.log('Setting dynamic multiplier', multiplier)
  await SettingsRepository.setMultiplier(multiplier)
}
