import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function runCommand(command, cwd) {
  console.log(`\n🚀 Running: ${command} in ${path.relative(rootDir, cwd) || 'root'}`);
  execSync(command, { cwd, stdio: 'inherit' });
}

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

try {
  // 1. Build the web dashboard
  const webDir = path.join(rootDir, 'web');
  runCommand('pnpm build', webDir);

  // 2. Clean and prepare server/public directory
  const serverDir = path.join(rootDir, 'server');
  const serverPublicDir = path.join(serverDir, 'public');
  
  console.log(`\n🧹 Cleaning and preparing target public folder: server/public`);
  if (fs.existsSync(serverPublicDir)) {
    fs.rmSync(serverPublicDir, { recursive: true, force: true });
  }
  fs.mkdirSync(serverPublicDir, { recursive: true });

  // 3. Copy built web assets to server/public
  const webBuildDir = path.join(webDir, 'build');
  console.log(`📁 Copying built web frontend from web/build to server/public`);
  if (fs.existsSync(webBuildDir)) {
    copyRecursiveSync(webBuildDir, serverPublicDir);
    console.log(`✅ Web frontend successfully copied.`);
  } else {
    throw new Error('Web build folder not found! Make sure Svelte build succeeded.');
  }

  // 4. Build the standalone server
  runCommand('pnpm build', serverDir);

  // 5. Build the CLI bridge extension
  const extensionDir = path.join(rootDir, 'extension');
  runCommand('pnpm build', extensionDir);

  console.log('\n✨ All components built and prepared successfully!');
} catch (error) {
  console.error('\n❌ Build failed:', error.message);
  process.exit(1);
}
