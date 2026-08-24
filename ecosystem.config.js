/**
 * PM2 Ecosystem Configuration
 *
 * PM2 supervises the canonical startup owner. start.sh remains responsible for
 * service admission, exposure configuration, web startup, and scoped cleanup.
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 delete metahuman-os
 *   pm2 monit
 *
 * Keep one forked instance: runtime coordinators and service owners are not
 * process-shared and must not be multiplied with PM2 cluster mode.
 */

module.exports = {
  apps: [
    {
      name: 'metahuman-os',
      script: './start.sh',
      cwd: '.',
      interpreter: 'bash',
      instances: 1,
      exec_mode: 'fork',

      // Environment
      env: {
        NODE_ENV: 'production',
        PORT: 4321,
      },

      // Stability settings
      min_uptime: '10s',           // Consider started after 10s
      max_restarts: 10,            // Max restarts before giving up
      restart_delay: 4000,         // Wait 4s between restarts

      // Logging
      log_file: './logs/pm2/combined.log',
      out_file: './logs/pm2/out.log',
      error_file: './logs/pm2/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

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
