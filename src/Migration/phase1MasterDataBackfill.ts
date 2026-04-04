import dayjs from 'dayjs'
import Container from '../Container/Container'
import Database from '../Services/firebase/Database'
import Firestore from '../Services/firebase/Firestore'
import { Store } from '../Services/store/Store'
import UserRecord from '../Models/UserRecord'
import DriverRecord from '../Models/DriverRecord'
import BranchModel from '../Models/Branch'
import CityModel from '../Models/City'
import ChatBotMessageRecord from '../Models/ChatBotMessageRecord'
import WpClientRecord from '../Models/WpClientRecord'
import RideFeeSettingRecord from '../Models/RideFeeSettingRecord'
import RideFeeDynamicMultiplierRecord from '../Models/RideFeeDynamicMultiplierRecord'
import { RideFeeInterface } from '../Types/RideFeeInterface'

type Dataset =
  | 'users'
  | 'drivers'
  | 'wp_clients'
  | 'ride_fees'
  | 'chatbot_messages'
  | 'branches'
  | 'all'

async function logValidationOutputs(): Promise<void> {
  const masterDataRepository = Container.getMasterDataRepository()
  const rowCounts = {
    users: await UserRecord.count(),
    drivers: await DriverRecord.count(),
    wp_clients: await WpClientRecord.count(),
    ride_fee_settings: await RideFeeSettingRecord.count(),
    ride_fee_dynamic_multipliers: await RideFeeDynamicMultiplierRecord.count(),
    chatbot_messages: await ChatBotMessageRecord.count(),
    branches: await BranchModel.count(),
    cities: await CityModel.count(),
  }

  console.log('Phase 1 row counts:', JSON.stringify(rowCounts, null, 2))

  const user = await UserRecord.findOne({ order: [['created_at', 'ASC']] })
  const driver = await DriverRecord.findOne({ order: [['created_at', 'ASC']] })
  const client = await WpClientRecord.findOne({ order: [['id', 'ASC']] })
  const message = await ChatBotMessageRecord.findOne({ order: [['id', 'ASC']] })
  const branches = await masterDataRepository.getBranches()
  const rideFees = await masterDataRepository.getRideFees()
  const rideFeesSnapshot = await masterDataRepository.buildPricingSnapshot()
  const firstBranch = branches[0]
  const firstCity = firstBranch?.cities[0]

  console.log(
    'Phase 1 spot checks:',
    JSON.stringify(
      {
        user: user
          ? {
              id: user.get('id'),
              email: user.get('email'),
              enabled_at: user.get('enabled_at'),
            }
          : null,
        driver: driver
          ? {
              id: driver.get('id'),
              email: driver.get('email'),
              paymentMode: driver.get('paymentMode'),
              balance: driver.get('balance'),
              enabled_at: driver.get('enabled_at'),
            }
          : null,
        wp_client: client
          ? {
              id: client.get('id'),
              alias: client.get('alias'),
              wpNotifications: client.get('wpNotifications'),
              service: client.get('service'),
            }
          : null,
        ride_fees: {
          price_kilometer: rideFees.price_kilometer,
          fees_base: rideFees.fees_base,
          fees_min_day: rideFees.fees_min_day,
          dynamic_multipliers: rideFees.dynamic_multipliers.length,
        },
        ride_fees_snapshot: {
          fees_minimum: rideFeesSnapshot.fees_minimum,
          fee_multiplier: rideFeesSnapshot.fee_multiplier,
        },
        chatbot_message: message
          ? {
              id: message.get('id'),
              enabled: message.get('enabled'),
            }
          : null,
        branch: firstBranch
          ? {
              id: firstBranch.id,
              country: firstBranch.country,
              currency_code: firstBranch.currency_code,
            }
          : null,
        city: firstCity
          ? {
              id: firstCity.id,
              branchId: firstCity.branchId,
              percentage: firstCity.percentage,
              location: firstCity.location,
              polygon_points: firstCity.polygon.length,
            }
          : null,
      },
      null,
      2
    )
  )
}

async function logCacheValidationOutputs(): Promise<void> {
  const store = Store.getInstance()

  await store.refreshMessages()
  await store.refreshWpClients()
  await store.getBranches()

  console.log(
    'Phase 1 SQL cache validation:',
    JSON.stringify(
      {
        chatbot_messages: store.messages.size,
        wp_clients: Object.keys(store.wpClients).length,
        branches: store.branches.size,
        cities: store.cities.size,
      },
      null,
      2
    )
  )
}

async function backfillUsers(): Promise<void> {
  const snapshot = await Database.db.ref('users').once('value')
  let count = 0
  const operations: Array<Promise<any>> = []

  snapshot.forEach((child) => {
    const value = child.val()
    operations.push(
      UserRecord.upsert({
        id: child.key as string,
        name: value.name ?? '',
        email: value.email ?? '',
        password: value.password ?? null,
        phone: value.phone ?? '',
        photoUrl: value.photoUrl ?? null,
        enabled_at: Number(value.enabled_at ?? 0),
        created_at: Number(value.created_at ?? 0),
        roles: value.roles ?? { operator: false, admin: false },
      })
    )
    count += 1
  })

  await Promise.all(operations)
  console.log(`Backfilled users: ${count}`)
}

async function backfillDrivers(): Promise<void> {
  const snapshot = await Database.dbDrivers().once('value')
  let count = 0
  const operations: Array<Promise<any>> = []

  snapshot.forEach((child) => {
    const value = child.val()
    operations.push(
      DriverRecord.upsert({
        id: child.key as string,
        name: value.name ?? '',
        email: value.email ?? '',
        password: value.password ?? null,
        phone: value.phone ?? '',
        phone2: value.phone2 ?? null,
        docType: value.docType ?? '',
        paymentMode: value.paymentMode ?? 'monthly',
        document: value.document ?? '',
        photoUrl: value.photoUrl ?? null,
        vehicle: value.vehicle ?? {},
        device: value.device ?? null,
        balance: Number(value.balance ?? 0),
        enabled_at: Number(value.enabled_at ?? 0),
        created_at: Number(value.created_at ?? 0),
        last_connection: Number(value.last_connection ?? 0),
      })
    )
    count += 1
  })

  await Promise.all(operations)
  console.log(`Backfilled drivers: ${count}`)
}

async function backfillWpClients(): Promise<void> {
  const snapshot = await Database.dbWpClients().once('value')
  let count = 0
  const operations: Array<Promise<any>> = []

  snapshot.forEach((child) => {
    const value = child.val()
    operations.push(
      Container.getMasterDataRepository().storeWpClient({
        id: child.key as string,
        alias: value.alias ?? '',
        wpNotifications: !!value.wpNotifications,
        full: !!value.full,
        chatBot: !!value.chatBot,
        assistant: !!value.assistant,
        service: value.service ?? 'whatsapp-web-js',
      })
    )
    count += 1
  })

  await Promise.all(operations)
  console.log(`Backfilled wp clients: ${count}`)
}

async function backfillRideFees(): Promise<void> {
  const snapshot = await Database.dbRideFees().once('value')
  const value = (snapshot.val() ?? {}) as Partial<RideFeeInterface>
  await Container.getMasterDataRepository().updateRideFees({
    price_kilometer: Number(value.price_kilometer ?? 0),
    price_minute: Number(value.price_minute ?? 0),
    fees_base: Number(value.fees_base ?? 0),
    fees_additional: Number(value.fees_additional ?? 0),
    fees_minimum: Number(value.fees_minimum ?? 0),
    fees_night: Number(value.fees_night ?? 0),
    fees_DxF: Number(value.fees_DxF ?? 0),
    fees_night_DxF: Number(value.fees_night_DxF ?? 0),
    fees_min_day: Number(value.fees_min_day ?? 0),
    fees_min_nigth: Number(value.fees_min_nigth ?? 0),
    fees_min_festive_day: Number(value.fees_min_festive_day ?? 0),
    fees_min_festive_nigth: Number(value.fees_min_festive_nigth ?? 0),
    timeout_to_complete: Number((value as any).timeout_to_complete ?? 240),
    timeout_to_connection: Number((value as any).timeout_to_connection ?? 120),
    fee_multiplier: Number(value.fee_multiplier ?? 1),
    dynamic_multipliers: value.dynamic_multipliers ?? [],
  })

  console.log('Backfilled ride fees: 1')
}

async function backfillChatBotMessages(): Promise<void> {
  const snapshot = await Firestore.dbChatBotMessages().get()
  let count = 0
  const operations: Array<Promise<any>> = []

  snapshot.forEach((doc) => {
    const value = doc.data()
    operations.push(
      ChatBotMessageRecord.upsert({
        id: doc.id,
        name: value.name ?? doc.id,
        description: value.description ?? '',
        message: value.message ?? '',
        enabled: !!value.enabled,
        interactive: value.interactive ?? null,
      })
    )
    count += 1
  })

  await Promise.all(operations)
  console.log(`Backfilled chatbot messages: ${count}`)
}

async function backfillBranches(): Promise<void> {
  const snapshot = await Database.dbBranches().once('value')
  let branchesCount = 0
  let citiesCount = 0
  const operations: Array<Promise<any>> = []

  snapshot.forEach((child) => {
    const value = child.val()
    operations.push(
      BranchModel.upsert({
        id: child.key as string,
        country: value.country ?? '',
        callingCode: value.calling_code ?? '',
        currencyCode: value.currency_code ?? '',
      })
    )
    branchesCount += 1

    Object.entries(value.cities ?? {}).forEach(([cityId, cityValue]: [string, any]) => {
      const location = cityValue.location ?? { lat: 0, lng: 0 }
      const polygonCoordinates = (cityValue.polygon ?? []).map((point: any) => [point.lng, point.lat])
      operations.push(
        CityModel.upsert({
          id: cityId,
          name: cityValue.name ?? cityId,
          percentage: Number(cityValue.percentage ?? 0),
          center: {
            type: 'Point',
            coordinates: [location.lng ?? 0, location.lat ?? 0],
          },
          polygon: polygonCoordinates.length > 0 ? {
            type: 'Polygon',
            coordinates: [polygonCoordinates],
          } : null,
          branchId: child.key as string,
        })
      )
      citiesCount += 1
    })
  })

  await Promise.all(operations)
  console.log(`Backfilled branches: ${branchesCount}, cities: ${citiesCount}`)
}

async function main(): Promise<void> {
  const dataset = (process.argv[2] ?? 'all') as Dataset
  await Container.initialize()

  switch (dataset) {
    case 'users':
      await backfillUsers()
      break
    case 'drivers':
      await backfillDrivers()
      break
    case 'wp_clients':
      await backfillWpClients()
      break
    case 'ride_fees':
      await backfillRideFees()
      break
    case 'chatbot_messages':
      await backfillChatBotMessages()
      break
    case 'branches':
      await backfillBranches()
      break
    case 'all':
      await backfillUsers()
      await backfillDrivers()
      await backfillWpClients()
      await backfillRideFees()
      await backfillChatBotMessages()
      await backfillBranches()
      break
    default:
      throw new Error(`Unsupported dataset: ${dataset}`)
  }

  await logValidationOutputs()
  await logCacheValidationOutputs()
  console.log(`Phase 1 backfill completed at ${dayjs().toISOString()}`)
  await Container.cleanup()
}

void main().catch(async (error) => {
  console.error('Phase 1 backfill failed:', error)
  await Container.cleanup()
  process.exit(1)
})
