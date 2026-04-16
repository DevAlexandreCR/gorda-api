import { firestore } from 'firebase-admin'
import Database from '../Services/firebase/Database'
import Firestore from '../Services/firebase/Firestore'

type CleanupMode = 'rtdb' | 'firestore-daily'
type FirestoreCleanupDataset =
  | 'messages'
  | 'metrics'
  | 'services'
  | 'sessions'
  | 'wpClientsMessages'
  | 'wpClientsChats'
  | 'wpClients'
type FirestoreCleanupStopReason = 'budget_exhausted' | 'completed'

type FirestoreCleanupSummary = {
  deleteCap: number
  deletedByDataset: Record<FirestoreCleanupDataset, number>
  endedAt: string
  remainingBudget: number
  startedAt: string
  stopReason: FirestoreCleanupStopReason
}

type FirestoreCleanupCursor = firestore.QueryDocumentSnapshot | null

const RTDB_PURGE_TARGETS = [
  'users',
  'drivers',
  'tokens',
  'places',
  'clients',
  'drivers_assigned',
  'online_drivers',
  'service_connections',
  'chats',
  'services',
] as const

const ROOT_FIRESTORE_COLLECTIONS: Array<{
  collection: 'messages' | 'metrics' | 'services' | 'sessions'
  dataset: Extract<FirestoreCleanupDataset, 'messages' | 'metrics' | 'services' | 'sessions'>
}> = [
    { collection: 'messages', dataset: 'messages' },
    { collection: 'metrics', dataset: 'metrics' },
    { collection: 'services', dataset: 'services' },
    { collection: 'sessions', dataset: 'sessions' },
  ]

const FIRESTORE_DAILY_DELETE_CAP = 15000
const ROOT_COLLECTION_BATCH_SIZE = 500
const GROUP_SCAN_BATCH_SIZE = 250
const WP_CLIENT_MESSAGE_PATH_DEPTH = 6
const WP_CLIENT_CHAT_PATH_DEPTH = 4
const WP_CLIENT_PATH_DEPTH = 2

function createDeleteCounts(): Record<FirestoreCleanupDataset, number> {
  return {
    messages: 0,
    metrics: 0,
    services: 0,
    sessions: 0,
    wpClientsMessages: 0,
    wpClientsChats: 0,
    wpClients: 0,
  }
}

function logStructured(event: string, payload: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      event,
      ...payload,
    })
  )
}

async function purgeRtdbRoot(path: (typeof RTDB_PURGE_TARGETS)[number]): Promise<void> {
  logStructured('phase5_rtdb_cleanup_root_started', {
    path,
    startedAt: new Date().toISOString(),
  })

  try {
    await Database.db.ref(path).set(null)
    logStructured('phase5_rtdb_cleanup_root_completed', {
      path,
      endedAt: new Date().toISOString(),
    })
  } catch (error) {
    logStructured('phase5_rtdb_cleanup_root_failed', {
      path,
      endedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function logDatasetPass(
  dataset: FirestoreCleanupDataset,
  queriedCount: number,
  candidateDeleteCount: number,
  remainingBudget: number
): void {
  logStructured('phase5_firestore_cleanup_dataset_pass', {
    dataset,
    queriedCount,
    candidateDeleteCount,
    remainingBudget,
  })
}

function logDatasetEmpty(dataset: FirestoreCleanupDataset, remainingBudget: number): void {
  logStructured('phase5_firestore_cleanup_dataset_empty', {
    dataset,
    queriedCount: 0,
    candidateDeleteCount: 0,
    remainingBudget,
  })
}

function isWpClientMessageDocument(document: firestore.QueryDocumentSnapshot): boolean {
  const pathSegments = document.ref.path.split('/')
  return (
    pathSegments.length === WP_CLIENT_MESSAGE_PATH_DEPTH &&
    pathSegments[0] === 'wpClients' &&
    pathSegments[2] === 'chats' &&
    pathSegments[4] === 'messages'
  )
}

function isWpClientChatDocument(document: firestore.QueryDocumentSnapshot): boolean {
  const pathSegments = document.ref.path.split('/')
  return (
    pathSegments.length === WP_CLIENT_CHAT_PATH_DEPTH &&
    pathSegments[0] === 'wpClients' &&
    pathSegments[2] === 'chats'
  )
}

function isWpClientDocument(document: firestore.QueryDocumentSnapshot): boolean {
  const pathSegments = document.ref.path.split('/')
  return pathSegments.length === WP_CLIENT_PATH_DEPTH && pathSegments[0] === 'wpClients'
}

async function deleteDocuments(
  writer: firestore.BulkWriter,
  documents: firestore.QueryDocumentSnapshot[],
  dataset: FirestoreCleanupDataset,
  summary: FirestoreCleanupSummary
): Promise<number> {
  if (documents.length === 0 || summary.remainingBudget === 0) {
    return 0
  }

  const documentsToDelete = documents.slice(0, summary.remainingBudget)
  const deleteOperations = documentsToDelete.map((document) => writer.delete(document.ref))
  await writer.flush()
  const results = await Promise.allSettled(deleteOperations)
  let successfulDeletes = 0

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      successfulDeletes += 1
      summary.deletedByDataset[dataset] += 1
      summary.remainingBudget -= 1
      return
    }

    logStructured('phase5_firestore_cleanup_delete_failed', {
      dataset,
      path: documentsToDelete[index].ref.path,
      remainingBudget: summary.remainingBudget,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    })
  })

  return successfulDeletes
}

async function cleanupRootCollection(
  writer: firestore.BulkWriter,
  collectionName: string,
  dataset: Extract<FirestoreCleanupDataset, 'messages' | 'metrics' | 'services' | 'sessions'>,
  summary: FirestoreCleanupSummary
): Promise<void> {
  while (summary.remainingBudget > 0) {
    const batchSize = Math.min(ROOT_COLLECTION_BATCH_SIZE, summary.remainingBudget)
    const snapshot = await Firestore.fs
      .collection(collectionName)
      .orderBy(firestore.FieldPath.documentId())
      .limit(batchSize)
      .get()

    if (snapshot.empty) {
      logDatasetEmpty(dataset, summary.remainingBudget)
      return
    }

    logDatasetPass(dataset, snapshot.size, snapshot.size, summary.remainingBudget)
    const successfulDeletes = await deleteDocuments(writer, snapshot.docs, dataset, summary)

    logStructured('phase5_firestore_cleanup_progress', {
      dataset,
      deleted: summary.deletedByDataset[dataset],
      remainingBudget: summary.remainingBudget,
      scanned: snapshot.size,
    })

    if (successfulDeletes === 0) {
      return
    }
  }
}

async function cleanupWpClientMessages(
  writer: firestore.BulkWriter,
  summary: FirestoreCleanupSummary
): Promise<void> {
  let cursor: FirestoreCleanupCursor = null

  while (summary.remainingBudget > 0) {
    let query = Firestore.fs
      .collectionGroup('messages')
      .orderBy(firestore.FieldPath.documentId())
      .limit(GROUP_SCAN_BATCH_SIZE)

    if (cursor) {
      query = query.startAfter(cursor)
    }

    const snapshot = await query.get()

    if (snapshot.empty) {
      logDatasetEmpty('wpClientsMessages', summary.remainingBudget)
      return
    }

    cursor = snapshot.docs[snapshot.docs.length - 1]
    const candidateDocuments = snapshot.docs
      .filter((document) => isWpClientMessageDocument(document))
      .slice(0, summary.remainingBudget)

    logDatasetPass(
      'wpClientsMessages',
      snapshot.size,
      candidateDocuments.length,
      summary.remainingBudget
    )

    if (candidateDocuments.length > 0) {
      await deleteDocuments(writer, candidateDocuments, 'wpClientsMessages', summary)
      logStructured('phase5_firestore_cleanup_progress', {
        dataset: 'wpClientsMessages',
        deleted: summary.deletedByDataset.wpClientsMessages,
        remainingBudget: summary.remainingBudget,
        scanned: snapshot.size,
      })
    }

    if (snapshot.size < GROUP_SCAN_BATCH_SIZE) {
      return
    }
  }
}

async function cleanupWpClientChats(
  writer: firestore.BulkWriter,
  summary: FirestoreCleanupSummary
): Promise<void> {
  let cursor: FirestoreCleanupCursor = null

  while (summary.remainingBudget > 0) {
    let query = Firestore.fs
      .collectionGroup('chats')
      .orderBy(firestore.FieldPath.documentId())
      .limit(GROUP_SCAN_BATCH_SIZE)

    if (cursor) {
      query = query.startAfter(cursor)
    }

    const snapshot = await query.get()

    if (snapshot.empty) {
      logDatasetEmpty('wpClientsChats', summary.remainingBudget)
      return
    }

    cursor = snapshot.docs[snapshot.docs.length - 1]
    const candidateDocuments = (
      await Promise.all(
        snapshot.docs
          .filter((document) => isWpClientChatDocument(document))
          .map(async (document) => {
            const messagesSnapshot = await document.ref.collection('messages').limit(1).get()
            return messagesSnapshot.empty ? document : null
          })
      )
    )
      .filter((document): document is firestore.QueryDocumentSnapshot => document !== null)
      .slice(0, summary.remainingBudget)

    logDatasetPass(
      'wpClientsChats',
      snapshot.size,
      candidateDocuments.length,
      summary.remainingBudget
    )

    if (candidateDocuments.length > 0) {
      await deleteDocuments(writer, candidateDocuments, 'wpClientsChats', summary)
      logStructured('phase5_firestore_cleanup_progress', {
        dataset: 'wpClientsChats',
        deleted: summary.deletedByDataset.wpClientsChats,
        remainingBudget: summary.remainingBudget,
        scanned: snapshot.size,
      })
    }

    if (snapshot.size < GROUP_SCAN_BATCH_SIZE) {
      return
    }
  }
}

async function cleanupWpClients(
  writer: firestore.BulkWriter,
  summary: FirestoreCleanupSummary
): Promise<void> {
  let cursor: FirestoreCleanupCursor = null

  while (summary.remainingBudget > 0) {
    let query = Firestore.fs
      .collection('wpClients')
      .orderBy(firestore.FieldPath.documentId())
      .limit(GROUP_SCAN_BATCH_SIZE)

    if (cursor) {
      query = query.startAfter(cursor)
    }

    const snapshot = await query.get()

    if (snapshot.empty) {
      logDatasetEmpty('wpClients', summary.remainingBudget)
      return
    }

    cursor = snapshot.docs[snapshot.docs.length - 1]
    const candidateDocuments = (
      await Promise.all(
        snapshot.docs
          .filter((document) => isWpClientDocument(document))
          .map(async (document) => {
            const chatsSnapshot = await document.ref.collection('chats').limit(1).get()
            return chatsSnapshot.empty ? document : null
          })
      )
    )
      .filter((document): document is firestore.QueryDocumentSnapshot => document !== null)
      .slice(0, summary.remainingBudget)

    logDatasetPass('wpClients', snapshot.size, candidateDocuments.length, summary.remainingBudget)

    if (candidateDocuments.length > 0) {
      await deleteDocuments(writer, candidateDocuments, 'wpClients', summary)
      logStructured('phase5_firestore_cleanup_progress', {
        dataset: 'wpClients',
        deleted: summary.deletedByDataset.wpClients,
        remainingBudget: summary.remainingBudget,
        scanned: snapshot.size,
      })
    }

    if (snapshot.size < GROUP_SCAN_BATCH_SIZE) {
      return
    }
  }
}

export async function purgeLegacyRtdbRootData(): Promise<void> {
  logStructured('phase5_rtdb_cleanup_started', {
    startedAt: new Date().toISOString(),
    targets: RTDB_PURGE_TARGETS,
  })

  for (const path of RTDB_PURGE_TARGETS) {
    await purgeRtdbRoot(path)
  }

  logStructured('phase5_rtdb_cleanup_completed', {
    endedAt: new Date().toISOString(),
    targets: RTDB_PURGE_TARGETS,
  })
}

export async function runPhase5FirestoreDailyCleanup(): Promise<FirestoreCleanupSummary> {
  const summary: FirestoreCleanupSummary = {
    deleteCap: FIRESTORE_DAILY_DELETE_CAP,
    deletedByDataset: createDeleteCounts(),
    endedAt: '',
    remainingBudget: FIRESTORE_DAILY_DELETE_CAP,
    startedAt: new Date().toISOString(),
    stopReason: 'completed',
  }

  logStructured('phase5_firestore_cleanup_started', {
    deleteCap: summary.deleteCap,
    remainingBudget: summary.remainingBudget,
    startedAt: summary.startedAt,
  })

  const writer = Firestore.fs.bulkWriter()
  writer.onWriteError((error) => {
    logStructured('phase5_firestore_cleanup_write_error', {
      code: error.code,
      failedAttempts: error.failedAttempts,
      message: error.message,
      path: error.documentRef.path,
    })
    return false
  })

  try {
    for (const dataset of ROOT_FIRESTORE_COLLECTIONS) {
      if (summary.remainingBudget === 0) {
        break
      }

      await cleanupRootCollection(writer, dataset.collection, dataset.dataset, summary)
    }

    if (summary.remainingBudget > 0) {
      await cleanupWpClientMessages(writer, summary)
    }

    if (summary.remainingBudget > 0) {
      await cleanupWpClientChats(writer, summary)
    }

    if (summary.remainingBudget > 0) {
      await cleanupWpClients(writer, summary)
    }

    summary.stopReason = summary.remainingBudget === 0 ? 'budget_exhausted' : 'completed'
    summary.endedAt = new Date().toISOString()

    logStructured('phase5_firestore_cleanup_completed', {
      deleteCap: summary.deleteCap,
      deletedByDataset: summary.deletedByDataset,
      endedAt: summary.endedAt,
      remainingBudget: summary.remainingBudget,
      startedAt: summary.startedAt,
      stopReason: summary.stopReason,
    })

    return summary
  } finally {
    await writer.close()
  }
}

function printPreview(mode: CleanupMode): void {
  if (mode === 'rtdb') {
    console.log(
      JSON.stringify(
        {
          execute: false,
          mode,
          targets: RTDB_PURGE_TARGETS,
          strategy: 'sequential_top_level_set_null',
        },
        null,
        2
      )
    )
    return
  }

  console.log(
    JSON.stringify(
      {
        deleteCap: FIRESTORE_DAILY_DELETE_CAP,
        execute: false,
        mode,
        targets: {
          rootCollections: ROOT_FIRESTORE_COLLECTIONS.map((dataset) => dataset.collection),
          wpClientsHierarchy: ['wpClients/*/chats/*/messages', 'wpClients/*/chats', 'wpClients'],
        },
      },
      null,
      2
    )
  )
}

async function main(): Promise<void> {
  const mode = process.argv[2] as CleanupMode | undefined
  const execute = process.argv.includes('--execute')

  if (!mode || (mode !== 'rtdb' && mode !== 'firestore-daily')) {
    throw new Error(
      'Usage: ts-node src/Migration/phase5FirebaseCleanup.ts <rtdb|firestore-daily> [--execute]'
    )
  }

  if (!execute) {
    printPreview(mode)
    return
  }

  if (mode === 'rtdb') {
    await purgeLegacyRtdbRootData()
    return
  }

  await runPhase5FirestoreDailyCleanup()
}

if (require.main === module) {
  void main().catch((error) => {
    console.error('Phase 5 cleanup failed:', error)
    process.exit(1)
  })
}
