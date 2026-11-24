module.exports = {
  apps: [{
    name: 'backend',
    script: './dist/app.js',
    cwd: '/var/www/C-Track/backend-express',
    instances: 1,
    exec_mode: 'fork',
    env_file: '.env',
    env: {
      NODE_ENV: 'development',
    },
    watch: false,
    max_memory_restart: '500M',
    error_file: '~/.pm2/logs/backend-error.log',
    out_file: '~/.pm2/logs/backend-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }]
};
