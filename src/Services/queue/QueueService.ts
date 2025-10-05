import { Job, Queue, Worker } from 'bullmq'
import config from '../../../config'

class QueueService {
  private static instance: QueueService
  private queues: Map<string, Queue> = new Map()
  private workers: Map<string, Worker> = new Map()

  public static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService()
    }
    return QueueService.instance
  }

  public addQueue(name: string): void {
    const queue = new Queue(name, {
      connection: {
        host: config.REDIS_HOST,
        port: parseInt(config.REDIS_PORT as string),
      },
    })
    this.queues.set(name, queue)
  }

  public async addWorker(queueName: string, callback: (data: any) => Promise<void>): Promise<void> {
    const queue = this.queues.get(queueName)
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`)
    }

    const worker = new Worker(
      queue.name,
      async (job: Job) => {
        await callback(job.data)
      },
      {
        connection: {
          host: config.REDIS_HOST,
          port: parseInt(config.REDIS_PORT as string),
        },
      }
    )

    this.workers.set(queueName, worker)
  }

  public add(queueName: string, data: any): void {
    const queue = this.queues.get(queueName)
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`)
    }

    queue.add(queueName, data)
  }
}

export default QueueService
