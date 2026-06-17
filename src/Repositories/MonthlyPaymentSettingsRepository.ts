import MonthlyPaymentSettingRecord from '../Models/MonthlyPaymentSettingRecord'
import { MonthlyPaymentSettingsInterface } from '../Interfaces/MonthlyPaymentSettingsInterface'

class MonthlyPaymentSettingsRepository {
  async get(): Promise<MonthlyPaymentSettingsInterface> {
    const [settings] = await MonthlyPaymentSettingRecord.findOrCreate({
      where: { id: 'default' },
      defaults: { id: 'default' },
    })

    return this.mapSettings(settings)
  }

  async upsert({
    suggested_amount,
    auto_disable,
    cutoff_day,
    reminder_offsets,
  }: {
    suggested_amount: number
    auto_disable: boolean
    cutoff_day: number
    reminder_offsets: number[]
  }): Promise<MonthlyPaymentSettingsInterface> {
    if (!Number.isInteger(cutoff_day) || cutoff_day < 1 || cutoff_day > 28) {
      throw new Error('Invalid cutoff_day: must be an integer between 1 and 28')
    }

    if (
      typeof suggested_amount !== 'number' ||
      !Number.isFinite(suggested_amount) ||
      suggested_amount < 0
    ) {
      throw new Error('Invalid suggested_amount: must be a number >= 0')
    }

    if (
      !Array.isArray(reminder_offsets) ||
      reminder_offsets.length === 0 ||
      !reminder_offsets.every((offset) => Number.isInteger(offset) && offset > 0)
    ) {
      throw new Error('Invalid reminder_offsets: must be an array of positive integers')
    }

    await MonthlyPaymentSettingRecord.upsert({
      id: 'default',
      suggested_amount,
      auto_disable,
      cutoff_day,
      reminder_offsets,
      updated_at: new Date(),
    })

    return this.get()
  }

  private mapSettings(settings: MonthlyPaymentSettingRecord): MonthlyPaymentSettingsInterface {
    const plain = settings.get({ plain: true }) as any
    return {
      id: plain.id,
      suggested_amount: Number(plain.suggested_amount),
      auto_disable: Boolean(plain.auto_disable),
      cutoff_day: Number(plain.cutoff_day),
      reminder_offsets: plain.reminder_offsets,
      updated_at: plain.updated_at,
    }
  }
}

export default MonthlyPaymentSettingsRepository
