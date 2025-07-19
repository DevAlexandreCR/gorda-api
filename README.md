# Gorda API

Gorda API is a Node.js backend that manages WhatsApp interactions for the Gorda platform. It receives and sends messages to users and drivers, exposes a set of HTTP endpoints and WebSocket events, and uses Firebase for storage and push notifications.

## Project Overview

The service acts as a bridge between the Gorda admin panel and the WhatsApp ecosystem. It supports several WhatsApp clients (official API and web based clients), handles chat bot logic, maintains driver and customer sessions and triggers Firebase Cloud Messaging notifications.

The codebase is written in TypeScript and provides cron jobs for housekeeping tasks such as removing inactive drivers, updating abandoned sessions and adjusting ride fees.

## Tech Stack

- **Node.js / TypeScript** – application runtime and type safety
- **Express** – HTTP server
- **Socket.IO** – realtime communication with the admin panel
- **Firebase Admin SDK** – Firestore/Realtime Database and FCM
- **whatsapp-web.js / Baileys / Official API** – WhatsApp integration
- **BullMQ** – background jobs
- **Sentry** – error tracking

## Installation

1. **Clone the repository**

   ```bash
   git clone <repo>
   cd gorda-api
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   Copy `.env.example` to `.env` and adjust values as needed. A Firebase service account JSON is also required (`firebaseAccount.json`).

4. **Build the project**

   ```bash
   npm run build
   ```

5. **Run locally**

   ```bash
   npm run serve
   ```

### Production

A sample `ecosystem.config.example.js` file is provided for running the compiled code using PM2. Set the proper environment variables and start the app with PM2 or your process manager of choice.

## API Endpoints

| Method | Endpoint               | Description                                                      |
| ------ | --------------------- | ---------------------------------------------------------------- |
| POST   | `/whatsapp/webhook`   | Receives WhatsApp webhook events (messages, status updates)       |
| GET    | `/whatsapp/webhook`   | Webhook verification endpoint                                     |
| POST   | `/polygon`            | Import a city polygon in KML format                               |
| POST   | `/messages/drivers`   | Send a push notification to drivers via Firebase Cloud Messaging   |

All routes accept JSON bodies. The webhook endpoint is used by Facebook/WhatsApp to deliver incoming messages.

## Components

- **Backend (this repository)** – Express server handling WhatsApp communication, cron jobs and Firebase integration.
- **Frontend** – An admin panel (not included here) connects to the backend through Socket.IO to authenticate and manage WhatsApp sessions.
- **Mobile App** – Drivers receive FCM notifications through the companion mobile app.

## WhatsApp Integration Flow

1. The admin panel connects to the backend via WebSocket and requests authentication.
2. `WhatsAppClient` initializes a WhatsApp session (either using the official API or a web client) and emits QR codes and state changes back through the socket.
3. Incoming messages from WhatsApp hit `/whatsapp/webhook` and are processed by the chatbot/service logic.
4. Notifications (service assigned, driver arrived, etc.) are sent to users through WhatsApp messages or FCM depending on configuration.

## Contribution

Contributions are welcome. Please open an issue or pull request describing your changes.

## License

This project is licensed under the ISC License as stated in `package.json`.

