# Gorda API Agents

This document explains the agents (long-running services, jobs, and helper modules) that make up the Gorda automation stack. Each agent encapsulates specific responsibilities so the team can reason about scaling, alerting, and on-call runbooks.

## 1. Runtime Agents

### 1.1 HTTP + Socket Hub (`src/app.ts`)
- Boots the Express server, HTTPS mirror, and attaches Socket.IO.
- Wires controllers under `/src/Api/Controllers/**` for WhatsApp webhooks, notifications, polygon uploads, and admin dashboard routes.
- Registers Sentry, CORS, static assets, and JSON parsing middleware.
- Owns the lifecycle of WhatsApp client instances (see below) via the dependency `Store` + `Container` bootstrap.
- Fails fast at boot, before any `WhatsAppClient` is built, if the Node runtime is below the floor Baileys 7.x requires (`>= 20.19.0`) — see `Helpers/NodeVersionGuard.ts`.

### 1.2 WhatsApp Client Agent (`src/Services/whatsapp/WhatsAppClient.ts`)
- Spins up one instance per configured `WpClient` entry.
- Bridges outbound messages from repositories/services to WhatsApp transports (Baileys or the official API, depending on client metadata) — the only two supported transports.
- Emits session state (QR, connection status, events) to Socket.IO for the admin UI under `wpServices[client.id]`.
- Delegates message classification to the chatbot service and persists audit trails via repositories.
- **Baileys transport (`@whiskeysockets/baileys` 7.0.0-rc14, ESM-only, loaded via Node's `require(esm)` — hence the Node floor above)**: no on-disk `store.json`; a bounded in-process cache of the messages this line sent serves `getMessage` retries instead, `syncFullHistory` is disabled, reconnect attempts back off up to 60s and reset on a successful `open`, and the session folder is deleted only on an explicit logout. Inbound senders under a `@lid` JID are resolved to a phone number before the message reaches the chatbot (unresolvable senders are audit-logged and skipped). The typing indicator sends a `composing` presence update. Catalog messages with buttons or lists render as numbered text, and a plain-text option pick against the chat's latest offered options is promoted back to an interactive reply.
- **Official (Cloud API) transport**: `MessageController.classifyInboundType` sorts every inbound message into `processable` (text, location, interactive, or anything carrying text), `media` (`audio`/`ptt`/`image`/`video`/`document`, with a caption treated as text) or `ignore` (everything else, including `unsupported`, `reaction`, `sticker`, `contacts`) — only `media` gets a single `MESSAGE_TYPE_NOT_SUPPORTED` catalog reply when the line's chatbot is enabled, `ignore` is silently logged (`inbound_ignored_type`) and never reaches the chatbot. A `list` interactive body also carries the numbered row titles (continuous across sections, 1024-char cap) so the candidates are visible without opening the picker, and a plain-text reply matching an offered number or name is promoted to the same `list_reply`/`button_reply` the Baileys path already synthesizes.

### 1.3 Chatbot Orchestrator (`src/Services/chatBot/**`)
- Turn pipeline: `Session.addMsg` → BullMQ delayed job → `processConversationTurn` → `Session.processMessage`, unchanged by the agent-first rework (turn gate, supersede gate, typing indicator, outbound persistence all stay).
- `Session.processMessage` dispatches by **line mode**, read from `Store` (`chatBot`, `assistant`, `agentInTrip`), not by a per-status handler class:
  - `wpNotifications` line: no session, no dispatch — `WhatsAppClient`/`serviceChanged` send lifecycle catalog messages straight from RTDB notifications.
  - `assistant` line: always the deterministic `LocationAssistantFlow` (`chatBot/deterministic/`) — no model call. Profile `pushname` used for name, pin + reference for place, then comment → `create_service`.
  - `chatBot` line: `SUPPORT`/`COMPLETED` no-op; `BOOKING`/`REQUESTING_SERVICE` → the agent turn (`CANCEL`/`INSIST` interactive replies short-circuit deterministically first); `SERVICE_IN_PROGRESS` → the agent turn only when the line's `agentInTrip` flag is on, otherwise a cancel-only deterministic handler.
- **Agent turn** (`chatBot/agent/`, `AgentTurn`): `AgentContextBuilder` assembles client, session `state`, active service, line facts and the last 40 messages → one bounded loop against the OpenAI Responses API (`OpenAIResponsesClient`, static prompt in `agent/prompts/agent.md`, one function tool `search_place` over `PlaceSearchRepository`, capped at `AGENT_MAX_TOOL_CALLS` tool calls, then a forced finalize) → `AgentValidator` (pure, checks place-id provenance, GPS requirements, service preconditions; any rejection discards the whole output and the model is re-invoked once with the rejection reason) → `AgentExecutor` (applies accepted actions through the existing repositories: create client, set place, book/cancel/insist a service, escalate to `SUPPORT`) → reply sent through the existing `sendMessage` path (suppressed on `create_service`, since the RTDB `new` notification is the single confirmation). `AgentTurn` owns every model/schema/validation failure itself (one `ERROR_WHILE_PROCESSING` message, `setStatus(SUPPORT)`) and never rethrows.
- Session state: `SessionStatuses` is `BOOKING | REQUESTING_SERVICE | SERVICE_IN_PROGRESS | COMPLETED | SUPPORT`; legacy per-step statuses are mapped to `BOOKING` on read. `chat_sessions.state` (JSONB) holds what a status used to encode (e.g. `pending_candidates`, `pending_pin`, `awaiting`) and is cleared on leaving `BOOKING`.
- **Candidate resolution**: `CandidateListMessage` turns search results into a list `Interactive` whose body also carries the numbered candidate names (plus "Ninguno de estos") on both transports. The agent prompt treats `session.pending_candidates` as a hint, not a lock: a plain-text reply that doesn't match an ordinal, number, name or short confirmation for that list triggers a fresh `search_place` call in the same turn instead of re-asking about stale candidates, and the model may not name or confirm a place absent from `pending_candidates` or the current turn's results.
- Config: `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-5.6-luna`), `OPENAI_REASONING_EFFORT` (default `none`) and `AGENT_MAX_TOOL_CALLS` (default 3) in `config.js`/`.env.example`; startup fails fast if `OPENAI_API_KEY` is missing while any line has `chatBot` enabled. The agent calls OpenAI directly from `api` over axios; `api` has no external HTTP dependency for chatbot intelligence.

### 1.4 Store Singleton (`src/Services/store/Store.ts`)
- Caches branches, WhatsApp clients, and settings so that the Socket/HTTP layers can read them without repeating DB calls.
- Emits hydrated data into memory upon app start (`store.getBranches()`, `store.getWpClients()` in `app.ts`).
- Acts as a central registry for downstream agents needing tenant-level configuration.
- Exposes `Store.isFeatureEnabled('vehicles.read_from_tables')` — the feature flag that gates reading vehicle data from Postgres tables vs. the legacy JSONB column. The flag is backed by the `settings` table and can be flipped live via `PUT /feature-flags/vehicles.read_from_tables`.

### 1.5 Driver-App Connect/Disconnect (`src/Api/Controllers/DriverAppController.ts`)
- `POST /driver-app/me/connect` is the single entry point for driver presence. It runs a five-step flow — check driver enabled → check vehicle enabled → check driver-vehicle link selectable → `ActiveVehicleAssignmentRepository.acquire` (SQL) → write `/online_drivers/{id}` to RTDB — all inside a single Sequelize transaction. Direct RTDB presence writes from the Android app are deprecated; the API now owns all writes to `/online_drivers`.
- `POST /driver-app/me/disconnect` idempotently deletes the assignment row and removes the RTDB presence node.
- **`ForceDisconnect` service** — internal helper called when an admin disables a vehicle or toggles `selectable=false` on an active link. It deletes the assignment, removes the RTDB node, and sends an FCM data payload `{ type: "force_disconnect", reason }` to the driver via the existing FCM path.
- **`AutoPromoteVehicle` service** — picks the most recently-linked eligible vehicle (`ORDER BY added_at DESC LIMIT 1`) and updates `drivers.selected_vehicle_id`; sets `NULL` if no eligible link exists. Called on `setSelectable=false` and on `vehicles.enabled=false` for every affected driver.

## 2. Background Jobs (`src/Jobs`)

| Job | File | Purpose | Trigger |
| --- | --- | --- | --- |
| RemoveConnectedDrivers | `RemoveConnectedDrivers.ts` | Clears lingering driver sessions to prevent ghost availability. | Cron via `node-cron` in `Schedule.ts`.
| CloseSessionsJob | `CloseSessionsJob.ts` | Auto-closes stale chat sessions and notifies admins. | Cron.
| PopulateMetrics | `PopulateMetrics.ts` | Aggregates usage metrics into analytics tables or Firebase. | Cron / manual.
| SetDynamicMinFeeJob | `SetDynamicMinFeeJob.ts` | Adjusts minimum ride fee based on demand windows. | Cron.
| SetDynamicMultiplierFeeJob | `SetDynamicMultiplierFeeJob.ts` | Maintains surge multipliers per branch. | Cron.
| CancelPendingServicesJob | `CancelPendingServicesJob.ts` | Auto-cancels pending services older than 15 minutes to prevent stale ride requests. | Cron (every 5 minutes).
| RemoveConnectedDrivers | `RemoveConnectedDrivers.ts` | Runs both as scheduled task and callable helper for incident response. | Cron + manual.

`Schedule.ts` exports the cron definitions that wire these jobs to `node-cron`. Each job usually coordinates with repositories (`SessionRepository`, `DriverRepository`, etc.) and may enqueue notifications through WhatsApp or Firebase.

**RemoveConnectedDrivers sweep cadence**: its `setInterval` is driven by `PRESENCE_SWEEP_INTERVAL_MS` (default 60000 ms), not `DISCONNECT_TIMEOUT`. It evicts any `online_drivers/{id}` whose `last_seen_at` is older than `DRIVER_STALE_SECONDS` (default 180s), releasing the vehicle mutex silently (no FCM). Rollout guard: after deploying this fix, keep `DRIVER_STALE_SECONDS` high (e.g. 86400) until the driver-app heartbeat release is adopted, then lower it to 180.

**Presence rollout runbook** (`fix-driver-presence-realtime`, production is PM2-managed — see `ecosystem.config.example.js`; env vars, including the rollout-guard starting value `DRIVER_STALE_SECONDS=86400`, live in the `.env` file at the PM2 `cwd`, not in the ecosystem file):
1. Deploy `api` (this fix: heartbeat endpoint, units fix, silent eviction, sweep interval) with `DRIVER_STALE_SECONDS=86400` in the `.env` file at the PM2 `cwd` (the app root).
2. Ship the `admin` `DriverMap.vue` fix — independent of the driver app, can go out any time.
3. Release the driver-app build with the location heartbeat, then raise `DRIVER_MIN_VERSION_CODE` (served as `versionPolicy.driver.minVersionCode`). This gate is enforced **at connect time only** (`precheckDriverConnectEligibility`) — drivers already connected on an old build keep a frozen marker until their next reconnect, which is exactly why step 1's high threshold must stay in place until adoption is confirmed.
4. Once adoption is confirmed, lower `DRIVER_STALE_SECONDS` to 180 (steady state) in that same `.env` file.

Rollback: raising `DRIVER_STALE_SECONDS` back up disables eviction; the heartbeat endpoint is harmless with no callers; the admin fix is standalone and needs no rollback coordination.

## 3. Queue Workers (`src/Services/queue`)

- Built on BullMQ (`bullmq` dependency) for Redis-backed background processing.
- Typical queues: message delivery retries, Firebase notifications, large polygon/KML imports, and heavy reporting tasks.
- Workers pull helpers from `/src/Helpers` (file I/O, date utilities) and persist transactional data via Sequelize models in `/src/Models`.
- Configure new workers by extending the base queue service and registering them inside the container so they share logging and configuration.

## 4. Data / Persistence Agents

### 4.1 Sequelize Layer (`src/Database`)
- `sequelize.ts` exports the configured Sequelize instance (PostgreSQL driver). Migration files live under `Database/Migrations` while seeders reflect initial data loads.
- Models under `/src/Models` adhere to interfaces in `/src/Interfaces`, ensuring that services stay strongly typed.
- **Vehicle tables** (added in `extract-vehicles-table`):
  - `vehicles` — master vehicle registry; `plate` has a unique index and is immutable after creation.
  - `driver_vehicles` — many-to-many join between drivers and vehicles with a per-link `selectable` boolean flag.
  - `active_vehicle_assignments` — enforces a one-driver-per-vehicle mutex; `vehicle_id` is the PK and `driver_id` has a separate unique constraint, so attempting to acquire an already-held assignment raises a named unique-constraint error that callers inspect to distinguish `vehicle_in_use` from `driver_already_connected`.

### 4.2 Repositories (`src/Repositories`)
- Each repository (`ClientRepository`, `PlaceRepository`, etc.) acts as an internal API for queries. Services never hit Sequelize directly; they request data through repositories so that caching, eager-loading, and auditing are centralized.
- `VehicleRepository` — `findByNormalizedPlate`, `findById`, `create`, `update`, `setEnabled`, `search`, `findWithLinkedDrivers`, and `findOrCreateByPlate` (uses `SELECT … FOR UPDATE` inside a transaction).
- `DriverVehicleRepository` — `listForDriver`, `link`, `setSelectable`, `findEligibleForDriver`, `findMostRecentEligible`.
- `ActiveVehicleAssignmentRepository` — `acquire`, `releaseByDriver`, `releaseByVehicle`, `findByDriver`, `findByVehicle`.

## 5. Notification Agents

### 5.1 Firebase Service (`src/Services/firebase`)
- Pushes FCM notifications for drivers and admins using `firebase-admin` credentials from `firebaseAccount.json`.
- Works with `NotificationController` to broadcast alerts triggered by HTTP calls or background jobs.

### 5.2 WhatsApp Notification Service
- Reuses the WhatsApp client agent but exposes helper methods (see `WpNotificationRepository` and `Services/whatsapp`) that translate domain events into WhatsApp templates or plain text.

## 6. Internationalization Layer

- Locale assets live under `src/Locales` with `locale.js` wiring the `i18n` module.
- `Locale.getInstance()` is invoked at bootstrap so every agent can call translation helpers without reconfiguration.

## 7. Operational Checklist

**Local development**: `api` runs inside Docker Compose. After finishing a change, restart the container from `dock/` so the running instance picks it up and the local stack stays functional:
```bash
docker compose restart api
```

1. **Bootstrap**: confirm `node -v` >= 20.19 (Baileys 7.x's ESM floor; the app also fails fast at boot below it), then `npm run build` followed by `npm run serve` (or PM2 using `ecosystem.config.example.js`). Ensure environment variables, Firebase credentials, and SSL certs (`src/Helpers/SSL.ts`) are available.
2. **Monitoring**: Sentry DSN configured; check Socket.IO logs for WhatsApp reconnect loops.
3. **Scaling WhatsApp Clients**: Add rows through the admin panel or seeders; the `Store` hot-reloads clients and `app.ts` instantiates a `WhatsAppClient` per tenant.
4. **Queue Health**: Inspect BullMQ dashboard (if configured) or Redis metrics, especially before marketing campaigns.
5. **Backups**: Keep current dumps of PostgreSQL (migrations + data) and Firebase service accounts. Rotate SSL certificates referenced in `config.APP_DOMAIN`.

## 8. Code Style Guidelines

- **Comments**: Avoid unnecessary comments. Code should be self-explanatory through clear naming and structure.
- **Necessary Comments**: When comments are needed (complex business logic, non-obvious behavior, or API quirks), write them in English.
- **Language**: All code, variable names, function names, and documentation must be in English for consistency across the codebase.
- **Documentation & Plans**: All planning documents, technical specifications, and implementation plans must be written in English and stored in the `/docs` directory. Plans should include problem description, proposed solution, implementation steps, test cases, and rollback procedures.
- **Changelog**: When a change (OpenSpec or otherwise) affecting `api` is completed, add a short entry to `CHANGELOG.md` under `## [Unreleased]`, matching the file's current Keep a Changelog format — never add a new version heading.

## 9. Adding a New Agent

1. Define the responsibility and data flow (HTTP, queue, cron, or helper).
2. Create a service module under `src/Services/<agent>` with clear interfaces.
3. Register any scheduled tasks in `src/Jobs/Schedule.ts` and expose configuration through `Store` if tenant-specific.
4. Update this `agents.md` file outlining the new agent’s trigger, dependencies, and failure modes.

Keeping agents loosely coupled (controllers → services → repositories) makes migrations, scaling, and debugging significantly easier. Always document how new agents are started, monitored, and stopped so the on-call team can respond quickly.
