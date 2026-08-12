import { Job, JobsOptions, Queue, Worker } from 'bullmq'
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

  public hasQueue(name: string): boolean {
    return this.queues.has(name)
  }

  public hasWorker(name: string): boolean {
    return this.workers.has(name)
  }

  public addQueue(name: string): void {
    // onReady (and similar bootstrap paths) can fire more than once per process
    // (reconnects, restartChromium). Skip re-registration instead of overwriting
    // the map entry, which would leak the previous Queue's Redis connection.
    if (this.hasQueue(name)) {
      console.log(`QueueService.addQueue: queue "${name}" already registered, skipping`)
      return
    }

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

    // Same idempotency guard as addQueue: a second worker on the same Redis
    // queue would double effective concurrency and leak a connection (design D6).
    if (this.hasWorker(queueName)) {
      console.log(`QueueService.addWorker: worker for queue "${queueName}" already registered, skipping`)
      return
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

  public add(queueName: string, data: any, opts?: JobsOptions): void {
    const queue = this.queues.get(queueName)
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`)
    }

    queue.add(queueName, data, opts)
  }
}

export default QueueService
