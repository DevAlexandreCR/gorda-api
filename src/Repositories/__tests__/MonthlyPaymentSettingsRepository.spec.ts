import MonthlyPaymentSettingsRepository from '../MonthlyPaymentSettingsRepository'
import MonthlyPaymentSettingRecord from '../../Models/MonthlyPaymentSettingRecord'

jest.mock('../../Models/MonthlyPaymentSettingRecord', () => ({
  findOrCreate: jest.fn(),
  upsert: jest.fn(),
}))

function makeSettingsModel(overrides: Record<string, any> = {}) {
  const plain = {
    id: 'default',
    suggested_amount: 0,
    auto_disable: true,
    cutoff_day: 4,
    reminder_offsets: [3, 1],
    updated_at: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  }
  return { get: ({ plain: _p }: any) => plain }
}

describe('MonthlyPaymentSettingsRepository.get()', () => {
  let repository: MonthlyPaymentSettingsRepository

  beforeEach(() => {
    jest.clearAllMocks()
    repository = new MonthlyPaymentSettingsRepository()
  })

  it('returns default values via find-or-create when no row exists yet', async () => {
    ;(MonthlyPaymentSettingRecord.findOrCreate as jest.Mock).mockResolvedValue([
      makeSettingsModel(),
      true,
    ])

    const result = await repository.get()

    expect(result).toEqual({
      id: 'default',
      suggested_amount: 0,
      auto_disable: true,
      cutoff_day: 4,
      reminder_offsets: [3, 1],
      updated_at: expect.any(Date),
    })
    expect(MonthlyPaymentSettingRecord.findOrCreate).toHaveBeenCalledWith({
      where: { id: 'default' },
      defaults: { id: 'default' },
    })
  })

  it('returns the persisted values when a row already exists', async () => {
    ;(MonthlyPaymentSettingRecord.findOrCreate as jest.Mock).mockResolvedValue([
      makeSettingsModel({ suggested_amount: 90000, cutoff_day: 10, reminder_offsets: [5, 2] }),
      false,
    ])

    const result = await repository.get()

    expect(result.suggested_amount).toBe(90000)
    expect(result.cutoff_day).toBe(10)
    expect(result.reminder_offsets).toEqual([5, 2])
  })
})

describe('MonthlyPaymentSettingsRepository.upsert()', () => {
  let repository: MonthlyPaymentSettingsRepository

  beforeEach(() => {
    jest.clearAllMocks()
    repository = new MonthlyPaymentSettingsRepository()
  })

  it('persists valid input and returns it via get()', async () => {
    ;(MonthlyPaymentSettingRecord.upsert as jest.Mock).mockResolvedValue([
      makeSettingsModel({ suggested_amount: 90000, cutoff_day: 5, reminder_offsets: [3, 1] }),
      true,
    ])
    ;(MonthlyPaymentSettingRecord.findOrCreate as jest.Mock).mockResolvedValue([
      makeSettingsModel({ suggested_amount: 90000, cutoff_day: 5, reminder_offsets: [3, 1] }),
      false,
    ])

    const result = await repository.upsert({
      suggested_amount: 90000,
      auto_disable: true,
      cutoff_day: 5,
      reminder_offsets: [3, 1],
    })

    expect(MonthlyPaymentSettingRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'default',
        suggested_amount: 90000,
        auto_disable: true,
        cutoff_day: 5,
        reminder_offsets: [3, 1],
      })
    )
    expect(result.suggested_amount).toBe(90000)
    expect(result.cutoff_day).toBe(5)
  })

  it('rejects cutoff_day = 0', async () => {
    await expect(
      repository.upsert({
        suggested_amount: 0,
        auto_disable: true,
        cutoff_day: 0,
        reminder_offsets: [3, 1],
      })
    ).rejects.toThrow(/cutoff_day/)

    expect(MonthlyPaymentSettingRecord.upsert).not.toHaveBeenCalled()
  })

  it('rejects cutoff_day = 31', async () => {
    await expect(
      repository.upsert({
        suggested_amount: 0,
        auto_disable: true,
        cutoff_day: 31,
        reminder_offsets: [3, 1],
      })
    ).rejects.toThrow(/cutoff_day/)

    expect(MonthlyPaymentSettingRecord.upsert).not.toHaveBeenCalled()
  })

  it('rejects a negative suggested_amount', async () => {
    await expect(
      repository.upsert({
        suggested_amount: -1,
        auto_disable: true,
        cutoff_day: 4,
        reminder_offsets: [3, 1],
      })
    ).rejects.toThrow(/suggested_amount/)

    expect(MonthlyPaymentSettingRecord.upsert).not.toHaveBeenCalled()
  })

  it('rejects non-positive-int reminder_offsets', async () => {
    await expect(
      repository.upsert({
        suggested_amount: 0,
        auto_disable: true,
        cutoff_day: 4,
        reminder_offsets: [3, 0],
      })
    ).rejects.toThrow(/reminder_offsets/)

    expect(MonthlyPaymentSettingRecord.upsert).not.toHaveBeenCalled()
  })

  it('rejects an empty reminder_offsets array', async () => {
    await expect(
      repository.upsert({
        suggested_amount: 0,
        auto_disable: true,
        cutoff_day: 4,
        reminder_offsets: [],
      })
    ).rejects.toThrow(/reminder_offsets/)

    expect(MonthlyPaymentSettingRecord.upsert).not.toHaveBeenCalled()
  })
})
