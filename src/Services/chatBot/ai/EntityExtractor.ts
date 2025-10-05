import { HfInference } from '@huggingface/inference'
import config from '../../../../config'

class EntityExtractor {
  static instance: HfInference | null = null

  static getInstance(progress_callback = undefined): HfInference {
    if (this.instance === null) {
      this.instance = new HfInference(config.HUGGINGFACE_TOKEN)
    }

    return this.instance
  }
  async extractName(text: string): Promise<string | false> {
    const npl = EntityExtractor.getInstance()

    const entities = await npl.tokenClassification(
      {
        model: config.ENTITY_MODEL_NAME ?? undefined,
        inputs: 'Me llamo ' + text,
      },
      {
        use_cache: true,
      }
    )

    if (entities.length === 0) {
      return Promise.resolve(false)
    }
    const names = entities[0].word
    return Promise.resolve(names)
  }
}

export default new EntityExtractor()
