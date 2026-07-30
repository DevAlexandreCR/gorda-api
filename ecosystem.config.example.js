module.exports = {
  apps: [{
    name: 'wp-api',
    script: '/path/to/wp-api/build/src/app.js',
    watch: false,
    instances: 1,
    cron_restart: '0 6 * * *',
    wait_ready: true,
    env: {
      "NODE_ENV": "local",
      "PORT": 80,
      "APP_DOMAIN": "localhost",
      "BASE_URL": "http://localhost",
      "FIREBASE_AUTHDOMAIN": "gorda-driver",
      "FIREBASE_PROJECT_ID": "gorda-driver",
      "FIREBASE_DATABASE_URL": "http://gorda-driver-default-rtdb.appspot.com:9199",
      "FIREBASE_STORAGE_BUCKET": "gorda-driver",
      "FIREBASE_MESSAGING_ID": "123456789098",
      "FIREBASE_APP_ID": "1:120116404187:web:a70c38fabcd123456",
      "FIREBASE_MEASUREMENT_ID": "G-1234567890",
      "FIREBASE_API_KEY": "AIzaSyBglx4HYweEXGAasflknlkfnankda",
      "DEFAULT_CLIENT_PHOTO_URL": "https://firebasestorage.googleapis.com/v0/b/gorda-driver.appspot.com/o/assets%2Fdefault_user.png?alt=media&token=89da7515-68d7-4d49-92ec-d88ce73514e6",
      "PQR_NUMBER": "3225351906",
      "SENTRY_DSN": "https://11f18cf765d54e30ace09a32259f4b48@o1307123.ingest.sentry.io/1234567",
      "CHROMIUM_PATH": "/usr/bin/chromium-browser",
      "CANCEL_TIMEOUT": 480000,
      "DISCONNECT_TIMEOUT": 900000,
      // Presence rollout guard (fix-driver-presence-realtime): deploy with
      // DRIVER_STALE_SECONDS high (e.g. 86400) so old driver-app builds that don't
      // yet send the location heartbeat aren't evicted 180s after connecting.
      // Sequence: 1) deploy api with this high value, 2) ship the admin DriverMap
      // fix, 3) release the driver app build with the heartbeat and raise
      // DRIVER_MIN_VERSION_CODE below (enforced at connect time only — drivers
      // already connected on an old build keep a frozen marker until they
      // reconnect), 4) once adoption is confirmed, lower DRIVER_STALE_SECONDS to
      // 180 (steady-state default, see api/config.js and api/agents.md).
      "DRIVER_STALE_SECONDS": 86400,
      "PRESENCE_SWEEP_INTERVAL_MS": 60000,
      // Raise only after step 3 above (driver app release) ships; connect-time gate only.
      "DRIVER_MIN_VERSION_CODE": 72,
      "INBOUND_MESSAGE_MAX_AGE_MINUTES": 120,
      "INBOUND_MESSAGE_DEDUP_TTL_SECONDS": 21600,
      "INBOUND_MESSAGE_METRICS_FLUSH_SECONDS": 60,
      "IGNORED_INBOUND_AUDIT_RETENTION_DAYS": 14,
      "GORDA_API_FUNCTIONS": "http://127.0.0.1:5001/gorda-driver/us-central1/api",
      "WAPI_TOKEN": "api-token",
      "WAPI_URL": "https://graph.facebook.com/v20.0/",
      "REDIS_HOST": "localhost",
      "REDIS_PORT": 6379,
      "AI_SERVICE_URL": "http://localhost:8000",
      "AI_SERVICE_API_KEY": "admin-token",
      "SERVER_API_KEY": "server-token",
      "DATABASE_URL": "postgresql://root:root@postgres:5432/gorda_db?schema=public",
      "SMTP_HOST": "smtp.gmail.com",
      "SMTP_PORT": 587,
      "SMTP_SECURE": false,
      "SMTP_USER": "gorda-driver@gmail.com",
      "SMTP_PASS": "password-123",
      "SMTP_FROM": "Gorda <gorda-driver@gmail.com>"
    }
  }]
}
