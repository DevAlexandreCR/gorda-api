import { Queue, Worker } from 'bullmq'
import QueueService from '../../../queue/QueueService'
import {
  CONVERSATION_TURN_JOB_OPTIONS,
  ConversationTurnPayload,
  enqueueConversationTurn,
  getConversationTurnQueueName,
  registerConversationTurnQueue,
} from '../ConversationTurnQueue'

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string) => ({
    name,
    add: jest.fn(),
  })),
  Worker: jest.fn().mockImplementation(() => ({})),
}))

function lastQueueInstance() {
  const mockQueue = Queue as unknown as jest.Mock
  return mockQueue.mock.results[mockQueue.mock.results.length - 1].value
}

describe('getConversationTurnQueueName', () => {
  it('names the queue after the wpClientId', () => {
    expect(getConversationTurnQueueName('client-1')).toBe('chatbot-turn-client-1')
  })
})

describe('registerConversationTurnQueue', () => {
  it('registers a queue and a worker for the given wpClientId', () => {
    const mockQueue = Queue as unknown as jest.Mock
    const mockWorker = Worker as unknown as jest.Mock
    const queueCallsBefore = mockQueue.mock.calls.length
    const workerCallsBefore = mockWorker.mock.calls.length

    registerConversationTurnQueue('client-2', async () => {})

    expect(mockQueue.mock.calls.length - queueCallsBefore).toBe(1)
    expect(mockWorker.mock.calls.length - workerCallsBefore).toBe(1)
    expect(QueueService.getInstance().hasQueue('chatbot-turn-client-2')).toBe(true)
    expect(QueueService.getInstance().hasWorker('chatbot-turn-client-2')).toBe(true)
  })

  it('is idempotent: calling it twice for the same wpClientId yields one queue and one worker', () => {
    const mockQueue = Queue as unknown as jest.Mock
    const mockWorker = Worker as unknown as jest.Mock

    registerConversationTurnQueue('client-3', async () => {})
    const queueCallsBefore = mockQueue.mock.calls.length
    const workerCallsBefore = mockWorker.mock.calls.length

    registerConversationTurnQueue('client-3', async () => {})

    expect(mockQueue.mock.calls.length - queueCallsBefore).toBe(0)
    expect(mockWorker.mock.calls.length - workerCallsBefore).toBe(0)
  })

  it('invokes the injected processor callback with the job payload', async () => {
    const processor = jest.fn().mockResolvedValue(undefined)
    registerConversationTurnQueue('client-4', processor)

    const mockWorker = Worker as unknown as jest.Mock
    const workerProcessorFn = mockWorker.mock.calls[mockWorker.mock.calls.length - 1][1]

    const payload: ConversationTurnPayload = {
      wpClientId: 'client-4',
      sessionId: 'session-1',
      chatId: 'chat-1',
      messageId: 'wamid.1',
    }
    await workerProcessorFn({ data: payload })

    expect(processor).toHaveBeenCalledWith(payload)
  })
})

describe('enqueueConversationTurn', () => {
  it('enqueues onto the wpClientId-scoped queue with attempts:1, removeOnComplete and the given delay', () => {
    registerConversationTurnQueue('client-5', async () => {})
    const queueInstance = lastQueueInstance()

    const payload: ConversationTurnPayload = {
      wpClientId: 'client-5',
      sessionId: 'session-1',
      chatId: 'chat-1',
      messageId: 'wamid.1',
    }
    enqueueConversationTurn(payload, 5000)

    expect(queueInstance.add).toHaveBeenCalledWith('chatbot-turn-client-5', payload, {
      ...CONVERSATION_TURN_JOB_OPTIONS,
      delay: 5000,
    })
  })

  it('passes delay 0 through unchanged (location/interactive/boot-sweep jobs)', () => {
    registerConversationTurnQueue('client-6', async () => {})
    const queueInstance = lastQueueInstance()

    const payload: ConversationTurnPayload = {
      wpClientId: 'client-6',
      sessionId: 'session-1',
      chatId: 'chat-1',
      messageId: 'wamid.2',
    }
    enqueueConversationTurn(payload, 0)

    expect(queueInstance.add).toHaveBeenCalledWith('chatbot-turn-client-6', payload, {
      ...CONVERSATION_TURN_JOB_OPTIONS,
      delay: 0,
    })
  })
})

describe('CONVERSATION_TURN_JOB_OPTIONS', () => {
  it('matches the design (attempts: 1, removeOnComplete: true) — no queue-level retries', () => {
    expect(CONVERSATION_TURN_JOB_OPTIONS).toEqual({ attempts: 1, removeOnComplete: true })
  })
})
