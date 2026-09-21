# Gorda API Service release notes

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add an agent-first conversation turn for `chatBot` lines: an OpenAI Responses model (`OpenAIResponsesClient`) drives each turn through a structured prompt, an `AgentContextBuilder` (session, place, and booking context), a `search_place` tool backed by the existing place-search strategy, deterministic action validation (`AgentValidator`), and an executor that applies the model's actions (set place, book service, send message). Booking is centralized in a new `ServiceBooking` helper shared by the agent and deterministic paths. Each turn emits a structured `agent_turn` log (inputs, actions, tool calls, outcome).
- Add `agent_in_trip` to `wp_clients` (surfaced as `agentInTrip` on the WpClient master-data contract) and `state` (JSONB) to `chat_sessions`, gating a new `LocationAssistantFlow` that lets the agent assist customers on `assistant` lines while a service is in progress (pin, name shortcut, comment, then service) — new `TurnDispatcher` routes each line to the agent-first or deterministic/assistant path per line mode.
- Add an interactive text fallback for the Baileys transport: `button`/`list` catalog messages render as body text followed by a numbered option list (`location_request_message` renders as body-only), and a customer's plain-text reply matching an offered option (ordinal or title) is resolved against the latest outbound interactive message of the chat and promoted to a synthesized `button_reply`/`list_reply`, so the chatbot sees the same `INTERACTIVE` message it sees on Official.
- Normalize Baileys inbound messages: unwrap `ephemeralMessage`/`viewOnceMessage`/`viewOnceMessageV2`, read text from `extendedTextMessage` as well as `conversation`, map native `buttonsResponseMessage`/`listResponseMessage`/`templateButtonReplyMessage`/`interactiveResponseMessage` to `INTERACTIVE`, and convert `Long` `messageTimestamp` values with Baileys' `toNumber`.
- Honor `list_reply.id` everywhere `button_reply.id` was already read (Official webhook controller, `Session.addMsg`, `DeterministicHandlers`, `WhatsAppClient` persistence), closing an existing Official false negative where a list selection reached the chatbot as an empty message.
- Send a `composing` presence update on Baileys for the typing indicator (previously a no-op).
- Add `is_first_reply` to the agent context's `session` facts (`AgentContextBuilder`), precomputed as "no assistant message in the bounded history" so the model no longer has to infer whether a turn is its first reply of the conversation.
- Render `search_place` candidates as a selectable list instead of leaving the model to enumerate them in prose. A new `CandidateListMessage` builds a `list` `Interactive` (row `id` = the place id, row `title` = the full, untruncated place name, plus a final `Ninguno de estos` escape row) from the LAST `search_place` call's candidates only — not the full per-turn ledger, which can hold up to 15 ids across `AGENT_MAX_TOOL_CALLS` calls and would otherwise mix an abandoned earlier query into the list WhatsApp caps at 10 rows. `AgentTurn` attaches it to the reply when the turn searched, got candidates back, and no place-setting action genuinely executed (gated on `AgentExecutor`'s `result.executed`, not `AgentValidator`'s `result.accepted`, so a `set_place` that silently no-ops still gets the customer a usable list). Row ids being place ids means a plain-text "2" round-trips through the existing `renderInteractiveAsText`/`resolveInteractiveOption` promotion and `session.state.pending_candidates` into a valid `set_place` with no new plumbing.

### Changed

- Collapse `SessionStatuses` to five values: `BOOKING`, `REQUESTING_SERVICE`, `SERVICE_IN_PROGRESS`, `COMPLETED`, `SUPPORT`. Legacy statuses are mapped to `BOOKING` on read for backward compatibility with existing rows.
- **Breaking:** replace the chatbot's environment contract. Added `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`, `AGENT_MAX_TOOL_CALLS`; removed `AI_SERVICE_URL`, `AI_SERVICE_API_KEY`, `HUGGINGFACE_TOKEN`, `ENTITY_MODEL_NAME`. The server now fails fast at startup if `OPENAI_API_KEY` is missing while a `chatBot` line is configured.
- Upgrade `@whiskeysockets/baileys` to `7.0.0-rc14` and declare `engines.node >= 20.19.0`, guarded by a startup check that exits with a clear message when the running Node version is below the floor.
- Rework the Baileys reconnect policy: the attempt counter resets on a successful `open`, retries back off exponentially (capped at 60s) instead of giving up after three attempts, reconnection is immediate on `restartRequired`, and the session folder is deleted only on `DisconnectReason.loggedOut` or an explicit logout.
- Replace the on-disk Baileys `store.json` (and its periodic flush) with an in-process bounded cache of sent messages used to serve `getMessage` retries; `syncFullHistory` is now disabled for faster pairing.
- Persist the outbound `interactive` payload in `TurnSupport.recordOutboundMessage` (previously always `null`), matching what `WhatsAppClient.sendMessage` already stores.
- Isolate per-line WhatsApp initialization failures in the `app.ts` boot loop so an unknown or misconfigured transport on one line no longer aborts initialization of the remaining lines.
- Send failures in the chatbot flow no longer terminate the process: the two `exit(1)` calls on the send-failure path (`TurnSupport.sendGatedMessage`, `Session.processMessage`) are replaced with structured logging, Sentry capture, and a normal rejection/error return handled by the existing turn-level error handling.
- Migrate existing `wp_clients` rows with `service = 'whatsapp-web-js'` to `baileys` (they require re-pairing); the `setWpClient` and backfill defaults now target `baileys`.

### Removed

- Remove the dependency on the `ia-app` service, the legacy `MessageStrategy` response strategies and `ai/*` client (`EntityExtractor`, `MessageHandler`, `GordaChatBot`), the `Types/Intent.ts` type, and the `@huggingface/inference` dependency.
- **Breaking:** remove the `whatsapp-web.js` transport (`WWebClient` and its adapters, the `whatsapp-web-js` transport value, `restartChromium`), the Chromium binary from the Docker image, and the `CHROMIUM_PATH`/`WWEB_VERSION` configuration. Any environment still pairing a whatsapp-web.js line must re-pair it as Baileys.

### Fixed

- Fix a process crash on restart: `WhatsAppClient.onMessageReceived` used to dereference `this.chatBot` (via `isProcessableMsg`) for queued/offline messages delivered before `onReady` assigns it, throwing an unhandled rejection that took down every WhatsApp line. The handler now skips chatbot processing (with a warning) until the chatbot is ready — the message stays persisted as unprocessed for `onReady`'s boot sweep — and the whole handler body is wrapped so no per-message error can escape and crash the process.
- Fix `PlaceSearchRepository.smartSearch` scoring the `exact` and `content` strategies as strings: their SQL selects a numeric literal, which node-postgres returns as a JS string, so the per-strategy score boost (`r.score + 1.0` / `+ 0.4`) string-concatenated instead of adding. This made a literal catalog-name match score `"1.01"` instead of `2.0`, losing to its own weaker `keyword` hit on the same place after `removeDuplicates` and silently discarding every `content` match once its concatenated score (e.g. `"0.90.4"`) failed the numeric `minScore` comparison as `NaN`. Both strategies now coerce their score to a number in `smartSearch` and cast the underlying SQL to `float`, restoring `chatbot-place-resolution`'s literal-match guarantee (an exact catalog name now reliably outranks any keyword/fuzzy/content hit on the same place and reports `hasStrongCandidate: true`).
- Fix the `build` script serving stale static assets: each `cp -r src/X build/src/X` step copied the source directory *inside* an already-existing destination on every rebuild after the first (producing `prompts/prompts`, `views/views`, `assets/assets`, `.well-known/.well-known`), leaving the original copy untouched. Since `AgentPrompt` resolves its prompt as `path.join(__dirname, 'prompts', 'agent.md')`, a built deployment kept serving the agent prompt from the first build ever made, silently ignoring every later prompt change. The copy steps are now idempotent (`mkdir -p` + `cp -r src/X/. build/src/X/`).
- Fix a pre-existing hole in the Official (Cloud API) transport: nothing enforced the API's interactive-message length limits, so any admin-configured catalog message with an over-long field would be rejected outright. `OfficialClient.getInteractive` now returns a sanitized copy (list row `title` 24 chars, row `description` 72, section `title` 24, `action.button` 20, button `reply.title` 20, `header.text`/`footer.text` 60, `body.text` 1024 — truncated with a single `…` when exceeded) without mutating the original `message.interactive`, which is also persisted to the message log. The cap is transport-specific: Baileys has none and renders the same payload as plain text.
- Fix `AgentExecutor.executeAgentActions` reporting `set_place`/`set_place_from_location` as `executed` merely because they were attempted, even when the apply silently no-opped (`PlaceRepository.findById` missing the id, or no location this turn and no pending pin). `applySetPlace` now returns whether the place was actually set, and `applySetPlaceFromLocation` reports `applied` separately from `halted` (a non-covered pin halts the turn but never applies a place). `executed` now only reflects what genuinely ran, which the candidate-list gate and the `agent_turn` log both depend on for accuracy.
- Fix `WhatsAppClient.isProcessableMsg` silently dropping real customer messages on agent-driven (`chatBot`) lines. The pre-existing courtesy filter (`MessageHelper.isCourtesyMessage`) scanned every adjacent bigram in the message and classified anything CONTAINING a courtesy phrase (e.g. "por favor") as pure courtesy, so a genuine service request like "Necesito un taxi en el centro por favor" never reached the chatbot at all — it was persisted for the admin log but never entered `Session.messages`, with no later re-processing. The courtesy check is now applied only when `wpClient.assistant` is true, matching `TurnDispatcher`'s own assistant-wins-over-chatBot routing: `LocationAssistantFlow` is a rigid deterministic pin → reference name → comment sequence that would swallow a stray "gracias" as the reference or the comment, while the agent turn on `chatBot` lines can judge acknowledgment vs. new intent itself, and `TurnDispatcher` already no-ops `SUPPORT`/`COMPLETED` sessions, covering the "thanks after a finished service" case this filter was originally written for. `MessageHelper.isCourtesyMessage` itself is also fixed to require the ENTIRE token sequence to partition into consecutive 1-2 token courtesy runs, instead of returning true merely because a courtesy bigram appears anywhere in the message — the defect stays fixed on the `assistant` path too, which still calls it. Accepted trade-offs: a bare "Gracias" during `REQUESTING_SERVICE` now reaches the agent and costs a model turn (judging that is the agent's job); a brand-new customer's first pure-courtesy message ("Ok", "Si") now creates a session and a model turn where it was previously dropped outright (`CloseSessionsJob` reaps abandoned sessions).

## [2.1.0(2026-09-05)](https://github.com/DevAlexandreCR/gorda-api/compare/2.1.0...2.0.14)

### Added

- Add a read-only payments audit API under `/payments`: paginated, filterable cross-driver listings of monthly payments and recharges (`GET /payments/monthly`, `GET /payments/recharges`), per-driver summary modes (`GET /payments/monthly/summary`, `GET /payments/recharges/summary`), and an actor lookup (`GET /payments/actors`) for the "registered by" filter.
- Compute anomaly flags server-side per row — `duplicate`, `atypical`, `outOfPeriod`, `voided` (monthly) — before any non-period filter is applied, and return footer totals over the whole filtered set using the same predicates as `/metrics/revenue`, so they tie out with it. No migration; no changes to any write path.

### Fixed

- Fix the chatbot going silent for every inbound message (all transports) after the 2.0.14 duplicate-reply fix: inbound rows are pre-persisted with `chat_session_id = NULL` before the chatbot runs, and `SessionRepository.addMsg` treated that state as a foreign-session duplicate, so no conversation turn was ever enqueued (most visibly, sharing a location on an assistant-enabled line no longer activated the bot). A null-session row is now adopted into the calling session via an atomic conditional update; rows genuinely owned by another session are still never re-parented.

## [2.0.14(2026-08-12)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.14...2.0.13)

### Fixed

- Fix a race in new-session registration that made the first message of any brand-new chat session fail the conversation turn (`Cannot read properties of undefined (reading 'created_at')`), plus a defensive guard in the conversation-turn processor that logs and discards a turn instead of crashing if it ever finds the in-memory session desynced from the database.
- Fixed chatbot outbound messages being stamped with millisecond timestamps, causing out-of-order message display and incorrect date separators in the admin chat.
- Fix duplicate chatbot replies on Official (Meta Cloud API) lines caused by accumulated singleton event listeners across `destroy`/`recreate` cycles and cross-session message re-parenting: `WPClientInterface` implementations now expose `removeAllListeners()`, called before re-registering wrapper events on client init, and `SessionRepository.addMsg` no longer re-parents a message row that already exists under a different chat session (it now returns `{created: false}` without mutating the row or downgrading `processed`).

## [2.0.13(2026-08-11)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.13...2.0.12)

### Added

- Persist bot replies to `whatsapp_messages` (`fromMe: true`, marked processed) so conversation history includes both sides of the chat; persistence failure is logged and never blocks sending the reply.
- Replace the chatbot's in-memory message buffering with a sliding-window debounce backed by delayed BullMQ jobs (one conversation-turn job per inbound message, on a per-WpClient queue, concurrency 1, survives process restarts): the bot now replies after the customer's *last* message instead of a fixed window from their first. Stale turns (a newer message arrived, or the session reached `COMPLETED`/`SUPPORT`) are discarded silently, before the AI call when possible and before any send or service-creation side effect otherwise, with no error-fallback message sent to the customer. New env var `CHATBOT_DEBOUNCE_MS` (default 5000) configures the debounce window. **Behavior change:** interactive button replies now process immediately instead of being buffered with text.
- Show a read receipt and "typing…" indicator to the customer on the Official (Meta Cloud API) transport while a debounce window and AI processing run; no-op on Baileys/WWebClient.
- Emit a structured per-turn outcome log (`completed | superseded_pre_ai | discarded_post_ai | error`) for the new conversation-turn processor.

### Changed

- Chatbot place resolution now auto-accepts a "strong candidate" search result — a dominant top score, or a sole full-coverage keyword match — instead of always asking for confirmation on non-literal matches; ambiguous results still go through the existing confirmation/suggestion flow. Keyword search scoring is now coverage-sensitive (score reflects the fraction of the query's keywords matched), so partial coincidental matches can no longer reach the auto-accept threshold.
- **Breaking (`ia-app` request contract):** AI requests now carry full session context instead of a bare message and status — the real session status (including `CREATED`, previously hardcoded to `ASKING_FOR_PLACE`), known data (client name, session place), and the last 10 conversation turns from both directions. Deploy together with the matching `ia-app` release.
- The AI response now carries a required `intent` classification (`PROVIDE_NAME`, `PROVIDE_PLACE`, `SUPPORT`, `REFUSAL`, `AMBIGUOUS`); the `Created`, `AskingForName`, and `AskingForPlace` chatbot strategies branch on it instead of only inspecting the extracted `place`/`session_status`. Name and place provided in a single message during name capture are both captured now — the place flow runs immediately instead of re-asking for the location.

### Fixed

- Fix SUPPORT messages that mention a place (e.g. "¿cuánto cuesta un viaje desde La Esmeralda?") being misread as a ride request — SUPPORT classification now takes precedence over an extracted `place` in the `AskingForPlace` and `Created` strategies.

- Fix production `.env` being silently ignored: `config.js` resolved it against the compiled `build/` directory (via `__dirname`), which never receives a copy of `.env`. Config now loads `.env` from the process working directory, and the PM2 ecosystem example drops its duplicated `env` block in favor of setting `cwd` so the app's own `.env` load is authoritative.

## [2.0.12(2026-08-01)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.12...2.0.11)

### Added

- Add an authenticated heartbeat endpoint `PUT /driver-app/me/location` that refreshes `location` and `last_seen_at` on `online_drivers/{id}` via an RTDB transaction: aborts with `410 not_connected` without ever recreating a removed presence node, and aborts with `409 session_superseded` to protect a newer session from being overwritten by a stale one.
- Add an optional `PRESENCE_SWEEP_INTERVAL_MS` env var (default 60000) driving the stale-presence sweep interval, decoupled from `DISCONNECT_TIMEOUT`.
- Add `directed_to` to the RTDB service interface and an `ORIGIN_TEST` constant for directed test services.
- Add `POST /driver-app/me/services`, letting a connected driver create a metered "self-service" trip (`origin='driver'`): online mode enforces eligibility (connected, enabled, monthly-or-positive-balance, not already busy) with typed rejection reasons; a `deferred: true` mode accepts app-reported timestamps and terminal data for trips completed offline, applying the terminal status as a second write so settlement and history triggers fire.
- Add `POST /driver-app/me/services/:id/cancel` for windowed driver cancellation of self-service trips, backed by a new `self_service_cancel_window` ride-fee setting (default 120s) delivered via the ride-fees snapshot.
- Add a `driver` ("Conductor") bucket to the billing service-source summary, excluded from the `admin`/`bot` buckets.
- Add an `origin` query param to `GET /services/history`.

### Changed

- Exclude `origin = 'test'` history rows from the `service_metrics_daily` rebuild (both `rebuildMetricsForDate` and `rebuildAllMetrics`), using a NULL-safe predicate, so directed test services no longer inflate operational counts or commission revenue.
- Exclude `origin = 'driver'` services from client-scoped completed-service counts.

### Fixed

- Fix stale-presence eviction in `RemoveConnectedDrivers`, which never fired due to a milliseconds-vs-seconds units mismatch between `last_seen_at` and the configured threshold. Eviction is now silent (no force-disconnect FCM push), releases the driver's vehicle assignment, and is immune to phantom staleness via a tracker purge on node removal plus a remove-if-stale RTDB transaction safe under concurrent sweeps.
- Fix self-service creation not upserting the `clients` row for the driver-derived `client_id`, which caused an FK violation when finalizing `service_history`.

## [2.0.11(2026-07-08)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.11...2.0.10)

### Added

- Add `GET /metrics/revenue` returning per-month commission earned, active monthly-fee income (excluding voided), paying-driver counts, and recharge totals.
- Add a `commission_sum` rollup column to `service_metrics_daily`, incrementally maintained on finalize and backfilled via `rebuildAllMetrics()`, so revenue reads never scan `service_history`.
- Expose a monthly frequency for the top-drivers metric.

## [2.0.10(2026-07-05)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.10...2.0.9)

### Added

- Support payment filtering on the drivers list (`GET /drivers`): filter by `paymentMode` (monthly/percentage) and by `paymentStatus` (paid/pending) for a given `period` (`YYYY-MM`, defaulting to the current Bogota period), joining active monthly payments to resolve paid/pending status.
- Add a route integrity audit endpoint (`GET /services/route-integrity`) that aggregates per-driver metrics (total trips, flagged trips, flagged ratio) over a date range, plus a `routeIntegrity=flagged` filter on `GET /services/history`. A single canonical rule flags terminated trips that went through the trip flow but have no usable route capture or a non-positive trip distance.

### Added

- Add an authenticated endpoint to void a driver monthly payment (`POST /drivers/:id/monthly-payments/:paymentId/void`) that soft-voids the record — recording status, reason, actor, and timestamp — without deleting it, preserving the audit trail.

### Changed

- Redefine "paid for a period" to count only active (non-voided) monthly payments, so a voided payment no longer counts as paid in the monthly payment reminder and auto-disable jobs or the manual re-enable gate.

## [2.0.8(2026-07-01)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.8...2.0.7)

### Added

- Persist the per-service driver deduction in a new `service_history.deducted_value` column (set from `metadata.discount` on finalize) and expose it on `GET /services/history`.

## [2.0.7(2026-06-30)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.7...2.0.6)

### Added

- Resolve and expose the per-service vehicle (`{ plate, brand, model, color }`) on the services history endpoint from the persisted `vehicle_id`, batching the lookup to avoid N+1.

### Fixed

- Include the resolved `selected_vehicle` in the unparameterized drivers list (`GET /drivers`) so consumers receive the driver's currently selected vehicle, not just its id.

## [2.0.6(2026-06-25)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.6...2.0.5)

### Added

- Add driver monthly payment domain: settings and payment records (models, migrations, repositories) with monthly payment validation when enabling drivers.
- Add scheduled jobs to send monthly payment reminders and disable drivers with unpaid monthly payments.
- Add a Bogota timezone helper service.

## [2.0.5(2026-06-12)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.5...2.0.4)

### Added

- Add normalized vehicle table migration, roster linking flow, and connect endpoint support for drivers. [#115](https://github.com/DevAlexandreCR/gorda-api/pull/115)

### Changed

- Tighten vehicle completeness validation and lookup response handling for the extracted vehicles flow. [#115](https://github.com/DevAlexandreCR/gorda-api/pull/115)

## [2.0.4(2026-06-08)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.4...2.0.3)

### Added

- Expose client completed services count through the services API and service creation flow.
- Add driver list filtering, sorting, pagination, and bulk enable/disable plus push notification endpoints.

### Changed

- Document Docker Compose local environment values in .env.example.

# Release Notes for 2.0.x

## [2.0.3(2026-04-14)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.3...2.0.2)

### Changed

- Improve conexion and balance

## [2.0.2(2026-04-14)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.2...2.0.1)

### Changed

- Improve performance of the app with SQL database

## [2.0.0(2026-04-14)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.0...1.6.2)

### Added

- Change firestore by SQL database

# Release Notes for 1.6.x

## [1.6.2 (2025-11-29)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.6.2...v1.6.1)

### Changed

- change db clients to postgres [#112](https://github.com/DevAlexandreCR/gorda-api/pull/112)


## [1.6.1 (2025-10-18)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.6.1...v1.6.0)

### Added

- full mode support. [#109](https://github.com/DevAlexandreCR/gorda-api/pull/109)

## [1.6.0 (2025-10-05)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.6.0...v1.5.4)

### Added

- Add postgres connection with Sequelize. [#106](https://github.com/DevAlexandreCR/gorda-api/pull/106)

# Release Notes for 1.5.x

## [1.5.4 (2025-07-09)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.5.4...v1.5.3)

### Added

- Add dynamic multiplier update. [#102](https://github.com/DevAlexandreCR/gorda-api/pull/102)

## [1.5.3 (2025-05-27)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.5.3...v1.5.2)

### Added

- Add support to interactive messages. [#100](https://github.com/DevAlexandreCR/gorda-api/pull/100)
- Add support to notifications. [#101](https://github.com/DevAlexandreCR/gorda-api/pull/101)

## [1.5.2 (2025-03-03)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.5.2...v1.5.1)

### Added

- Add queue jobs to send messages. [#98](https://github.com/DevAlexandreCR/gorda-api/pull/98)

## [1.5.1 (2024-12-02)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.5.1...v1.5.1)

### Added

- Cron to set dynamic min fee.

## [1.5.0 (2024-11-30)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.5.0...v1.4.5)

### Added

- Add get city from location. ([#96](https://github.com/DevAlexandreCR/gorda-api/pull/96)

# Release Notes for 1.4.x

## [1.4.5 (2024-10-30)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.4.5...v1.4.4)

### Added

- Add location button to interactive message. ([#94](https://github.com/DevAlexandreCR/gorda-api/pull/94)

## [1.4.4 (2024-10-14)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.4.4...v1.4.3)

### Added

- Restart button from frontend. ([#92](https://github.com/DevAlexandreCR/gorda-api/pull/92))

## [1.4.3 (2024-09-15)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.4.3...v1.4.2)

### Fixed

- Fix errors on connection Baileys. ([#90](https://github.com/DevAlexandreCR/gorda-api/pull/90))

## [1.4.2 (2024-09-12)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.4.2...v1.4.1)

### Added

- Implement Baileys ans fix errors. ([#90](https://github.com/DevAlexandreCR/gorda-api/pull/90))

## [1.4.1 (2024-09-04)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.4.1...v1.4.0)

### Fixed

- Location Messages in chatbot. ([#88](https://github.com/DevAlexandreCR/gorda-api/pull/88))

## [1.4.0 (2024-07-23)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.4.0...v1.3.7)

### Added

- New Whatsapp Api connection. ([#86](https://github.com/DevAlexandreCR/gorda-api/pull/86))

# Release Notes for 1.3.x

## [1.3.7 (2024-05-14)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.7...v1.3.6)

### Fixed

-   Restart chromium on exit ([#84](https://github.com/DevAlexandreCR/gorda-api/pull/84))

## [1.3.6 (2024-05-14)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.6...v1.3.5)

### Fixed

-   Overwritten messages ([#82](https://github.com/DevAlexandreCR/gorda-api/pull/82))

## [1.3.5 (2024-05-13)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.5...v1.3.4)

### Added

-   Get Messages from DB ([#80](https://github.com/DevAlexandreCR/gorda-api/pull/80))

## [1.3.4 (2024-04-03)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.4...v1.3.3)

### Fixed

-   Add wweb version from remote ([#79](https://github.com/DevAlexandreCR/gorda-api/pull/79))

## [1.3.3 (2024-03-23)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.3...v1.3.2)

### Fixed

-   Message unsupported ([#77](https://github.com/DevAlexandreCR/gorda-api/pull/77))

## [1.3.2 (2024-03-20)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.2...v1.3.1)

### Fixed

-   Send completed when assistant enabled ([#74](https://github.com/DevAlexandreCR/gorda-api/pull/74))

## [1.3.1 (2024-03-20)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.1...v1.3.0)

### Fixed

-   node-fetch not found huggingface ([#73](https://github.com/DevAlexandreCR/gorda-api/pull/73))

## [1.3.0 (2024-03-19)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.0...v1.2.1)

### Added

-   Added ChatBot and assistant ([#70](https://github.com/DevAlexandreCR/gorda-api/pull/70))

# Release Notes for 1.2.x

## [1.2.1 (2024-02-26)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.2.1...v1.2.0)

### Changed

-   Change messages new service. [#68](https://github.com/DevAlexandreCR/gorda-api/pull/68)

## [1.2.0 (2024-02-03)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.2.0...v1.1.18)

### Added

-   A Client can use mor than 1 wpClient. [#66](https://github.com/DevAlexandreCR/gorda-api/pull/66)

# Release Notes for 1.1.x

## [1.1.21 (2023-12-16)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.21...v1.1.20)

### Changed

-   Change new service message. [#64](https://github.com/DevAlexandreCR/gorda-api/pull/64)

## [1.1.20 (2023-12-08)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.20...v1.1.19)

### Changed

-   Change assigned message. [#62](https://github.com/DevAlexandreCR/gorda-api/pull/62)

## [1.1.19 (2023-08-09)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.19...v1.1.18)

### Fixed

-   Fixed promise was collected. [#61](https://github.com/DevAlexandreCR/gorda-api/pull/61)

## [1.1.18 (2023-08-09)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.18...v1.1.17)

### Fixed

-   Fixed send messages. [#59](https://github.com/DevAlexandreCR/gorda-api/pull/59)

## [1.1.17 (2023-08-09)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.17...v1.1.16)

### Fixed

-   Upgrade version of wp-webjs. [#57](https://github.com/DevAlexandreCR/gorda-api/pull/57)

## [1.1.16 (2023-07-11)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.16...v1.1.15)

### Added

-   Add cron to populate metrics. [#55](https://github.com/DevAlexandreCR/gorda-api/pull/55)

## [1.1.15 (2023-07-10)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.15...v1.1.14)

### Added

-   Add cron to remove inactive drivers. [#52](https://github.com/DevAlexandreCR/gorda-api/pull/52)

## [1.1.14 (2023-05-20)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.14...v1.1.13)

### Changed

-   Update wp web. [#50](https://github.com/DevAlexandreCR/gorda-api/pull/50)

## [1.1.13 (2023-05-13)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.13...v1.1.12)

### Changed

-   Remove prices from messages.
-   Add ask for cancel message. [#48](https://github.com/DevAlexandreCR/gorda-api/pull/48)

## [1.1.11 (2023-04-24)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.11...v1.1.10)

### Changed

-   Remove keep alive. [#46](https://github.com/DevAlexandreCR/gorda-api/pull/46)

## [1.1.10 (2023-03-27)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.10...v1.1.8)

### Added

-   Save received messages. [#44](https://github.com/DevAlexandreCR/gorda-api/pull/44)

## [1.1.8 (2023-03-15)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.8...v1.1.7)

### Fixed

-   Add onLoading screen. [#40](https://github.com/DevAlexandreCR/gorda-api/pull/40)

## [1.1.6 (2023-03-08)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.6...v1.1.5)

### Fixed

-   Fixed interval 5min. [#37](https://github.com/DevAlexandreCR/gorda-api/pull/37)

## [1.1.5 (2023-03-08)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.5...v1.1.1)

### Added

-   Add new Service notification. [#33](https://github.com/DevAlexandreCR/gorda-api/pull/35)

## [1.1.1 (2023-02-28)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.0.7...v1.1.1)

### Changed

-   Add exit after crash. [#33](https://github.com/DevAlexandreCR/gorda-api/pull/33)

# Release Notes for 1.0.x

## [1.0.7 (2023-01-08)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.0.6...v1.0.7)

### Changed

-   update node dependencies [#26](https://github.com/DevAlexandreCR/gorda-api/pull/26)
