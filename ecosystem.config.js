module.exports = {
  apps: [{
    name: 'hdyy',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      PORT: 3000,
      NODE_ENV: 'production',
    },
    max_memory_restart: '500M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
