// Trims the `mastra build` output before it goes into the server image.
//   node scripts/slim-output.mjs <output dir>
//
// onnxruntime-node (used by the local embedding model) ships its native library for
// every platform in one package, about 290 MB, of which only one platform's copy is
// ever loaded. This removes the copies for the other operating systems and CPUs.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function dirs(path) {
  try {
    return readdirSync(path).filter((name) => statSync(join(path, name)).isDirectory());
  } catch {
    return [];
  }
}

/** Every onnxruntime-node package folder under a pnpm node_modules tree. */
function onnxPackages(outputDir) {
  const store = join(outputDir, 'node_modules', '.pnpm');
  return dirs(store)
    .filter((name) => name.startsWith('onnxruntime-node@'))
    .map((name) => join(store, name, 'node_modules', 'onnxruntime-node'));
}

/**
 * Removes the native binaries the image's platform never loads. Returns the
 * removed folders, relative to `outputDir`.
 */
export function slimOutput(outputDir, { platform = process.platform, arch = process.arch } = {}) {
  const removed = [];
  for (const pkg of onnxPackages(outputDir)) {
    const bin = join(pkg, 'bin');
    for (const napi of dirs(bin)) {
      for (const os of dirs(join(bin, napi))) {
        const osDir = join(bin, napi, os);
        if (os !== platform) {
          rmSync(osDir, { recursive: true, force: true });
          removed.push(osDir.slice(outputDir.length + 1));
          continue;
        }
        for (const cpu of dirs(osDir)) {
          if (cpu === arch) continue;
          const cpuDir = join(osDir, cpu);
          rmSync(cpuDir, { recursive: true, force: true });
          removed.push(cpuDir.slice(outputDir.length + 1));
        }
      }
    }
  }
  return removed;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outputDir = process.argv[2];
  if (!outputDir) {
    console.error('usage: node scripts/slim-output.mjs <output dir>');
    process.exit(1);
  }
  const removed = slimOutput(outputDir);
  console.log(`slim-output: removed ${removed.length} folder(s)`);
  for (const path of removed) console.log(`  ${path}`);
}
