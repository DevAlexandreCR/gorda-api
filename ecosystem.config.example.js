// Env vars are loaded by the app itself from `<cwd>/.env` (see config.js), with
// override enabled, so no `env` block is needed here. See `.env.example` for the
// full variable list. After editing `.env`, a plain `pm2 restart wp-api` is
// enough since the app re-reads the file at boot.
module.exports = {
  apps: [{
    name: 'wp-api',
    script: 'build/src/app.js',
    cwd: '/path/to/wp-api',
    watch: false,
    instances: 1,
    cron_restart: '0 6 * * *',
    wait_ready: true
  }]
}
