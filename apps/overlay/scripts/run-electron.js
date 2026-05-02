const { spawn } = require('child_process');
const path = require('path');

const electronPath = require('electron');
const mainPath = path.join(__dirname, '..', 'dist', 'main.js');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [mainPath], {
  stdio: 'inherit',
  env
});

child.on('exit', (code) => process.exit(code || 0));
