import Container from '../Container/Container'

export async function setDynamicMultiplierFee(): Promise<void> {
  const rideFees = await Container.getMasterDataRepository().buildPricingSnapshot()
  console.log('Resolved SQL dynamic multiplier', rideFees.fee_multiplier)
}
