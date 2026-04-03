import Container from '../Container/Container'

export async function setDynamicMinFee(): Promise<void> {
  const rideFees = await Container.getMasterDataRepository().buildPricingSnapshot()
  console.log('Resolved SQL minimum fee', rideFees.fees_minimum)
}
