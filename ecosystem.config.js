/**
 * PM2 Ecosystem Configuration
 *
 * This file configures PM2 to manage the MetaHuman OS web server.
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 stop all
 *   pm2 restart all
 *   pm2 monit
 *
 * Note: Agents (scheduler-service, audio-organizer) are NOT managed by PM2
 * because they use file-based locks for single-instance guarantees.
 * They continue to be managed by ./bin/mh start
 */

module.exports = {
  apps: [
    {
      name: 'metahuman-web',
      script: 'dist/server/entry.mjs',
      cwd: './apps/site',

      // Cluster mode: use all CPU cores
      instances: 'max',
      exec_mode: 'cluster',

      // Environment
      env: {
        NODE_ENV: 'production',
        PORT: 4321,
      },

      // Stability settings
      max_memory_restart: '1G',    // Restart if memory exceeds 1GB
      min_uptime: '10s',           // Consider started after 10s
      max_restarts: 10,            // Max restarts before giving up
      restart_delay: 4000,         // Wait 4s between restarts

      // Logging
      log_file: './logs/pm2/combined.log',
      out_file: './logs/pm2/out.log',
      error_file: './logs/pm2/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,            // Merge cluster logs into single files

      // Graceful shutdown
      kill_timeout: 5000,          // Wait 5s for graceful shutdown
      listen_timeout: 10000,       // Wait 10s for app to listen

      // Watch mode (disabled for production)
      watch: false,
      ignore_watch: ['node_modules', 'logs', '.git', 'memory', 'persona'],

      // Source maps
      source_map_support: true,
    },
  ],
};
