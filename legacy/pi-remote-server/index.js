#!/usr/bin/env node

console.log('\n\x1b[41m\x1b[37m ⚠️  DEPRECATION NOTICE \x1b[0m');
console.log('\x1b[33m%s\x1b[0m', 'pi-remote-server has been renamed to wherever-dev (https://wherever.dev).\n');
console.log('To migrate, please run the following commands:');
console.log('\x1b[32m%s\x1b[0m', '  npm uninstall -g pi-remote-server');
console.log('\x1b[32m%s\x1b[0m', '  npm install -g wherever-dev\n');
console.log('Once upgraded, start your server using the new command:');
console.log('\x1b[36m%s\x1b[0m', '  wherever\n');

process.exit(1);
