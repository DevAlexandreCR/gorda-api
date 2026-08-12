import { Queue, Worker } from 'bullmq'
import QueueService from '../QueueService'

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string) => ({
    name,
    add: jest.fn(),
  })),
  Worker: jest.fn().mockImplementation(() => ({})),
}))

// Returns the mocked Queue instance created by the most recent addQueue() call.
function lastQueueInstance() {
  const mockQueue = Queue as unknown as jest.Mock
  return mockQueue.mock.results[mockQueue.mock.results.length - 1].value
}

describe('QueueService.add', () => {
  const service = QueueService.getInstance()

  it('passes opts through to queue.add when provided', () => {
    service.addQueue('turn-queue-opts')
    const queueInstance = lastQueueInstance()

    const opts = { delay: 5000, attempts: 1, removeOnComplete: true }
    service.add('turn-queue-opts', { foo: 'bar' }, opts)

    expect(queueInstance.add).toHaveBeenCalledWith('turn-queue-opts', { foo: 'bar' }, opts)
  })

  it('keeps existing callers working when opts is omitted', () => {
    service.addQueue('turn-queue-no-opts')
    const queueInstance = lastQueueInstance()

    service.add('turn-queue-no-opts', { foo: 'bar' })

    expect(queueInstance.add).toHaveBeenCalledWith('turn-queue-no-opts', { foo: 'bar' }, undefined)
  })

  it('throws when the queue was not registered', () => {
    expect(() => service.add('missing-queue', {})).toThrow('Queue missing-queue not found')
  })
})

describe('QueueService idempotent registration (design D6)', () => {
  const service = QueueService.getInstance()

  it('registering the same queue name twice creates only one Queue instance', () => {
    const mockQueue = Queue as unknown as jest.Mock
    const callsBefore = mockQueue.mock.calls.length

    service.addQueue('turn-queue-idempotent')
    service.addQueue('turn-queue-idempotent')

    expect(mockQueue.mock.calls.length - callsBefore).toBe(1)
    expect(service.hasQueue('turn-queue-idempotent')).toBe(true)
  })

  it('registering a worker for the same queue name twice yields one worker', async () => {
    const mockWorker = Worker as unknown as jest.Mock
    const callsBefore = mockWorker.mock.calls.length

    service.addQueue('turn-queue-worker-idempotent')
    await service.addWorker('turn-queue-worker-idempotent', async () => {})
    await service.addWorker('turn-queue-worker-idempotent', async () => {})

    expect(mockWorker.mock.calls.length - callsBefore).toBe(1)
    expect(service.hasWorker('turn-queue-worker-idempotent')).toBe(true)
  })
})
