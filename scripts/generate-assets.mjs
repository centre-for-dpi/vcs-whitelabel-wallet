/**
 * Generates all required store/app assets.
 * Run: node scripts/generate-assets.mjs
 *
 * Sources:
 *   assets/robi-icon.png  → icon.png + adaptive-icon.png (launcher icon)
 *   assets/logo.png       → splash.png (splash screen)
 *
 * Outputs:
 *   assets/icon.png            — 1024×1024, white bg  (iOS App Store, Play Store listing)
 *   assets/adaptive-icon.png   — 1024×1024, transparent bg with padding (Android adaptive icon foreground)
 *   assets/splash.png          — 1284×2778, white bg, centered logo (splash screen)
 */

import sharp from 'sharp';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const iconSrc = join(root, 'assets', 'robi-icon.png');
const splashSrc = join(root, 'assets', 'logo.png');

if (!existsSync(iconSrc)) {
  console.error('❌  assets/robi-icon.png not found');
  process.exit(1);
}
if (!existsSync(splashSrc)) {
  console.error('❌  assets/logo.png not found');
  process.exit(1);
}

const out = (name) => join(root, 'assets', name);

// ── icon.png — 1024×1024, white background (no alpha — required by iOS) ───────
await sharp(iconSrc)
  .resize(820, 820, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .flatten({ background: { r: 255, g: 255, b: 255 } })
  .extend({ top: 102, bottom: 102, left: 102, right: 102, background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .toFile(out('icon.png'));
console.log('✅  icon.png (1024×1024, white bg, from robi-icon.png)');

// ── adaptive-icon.png — 1024×1024, transparent bg, logo in safe zone (66%) ───
await sharp(iconSrc)
  .resize(683, 683, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .extend({ top: 170, bottom: 171, left: 170, right: 171, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toFile(out('adaptive-icon.png'));
console.log('✅  adaptive-icon.png (1024×1024, transparent, safe-zone padded, from robi-icon.png)');

// ── splash.png — 1284×2778, white background, logo centered at 400px ──────────
const splashLogoSize = 400;
const splashW = 1284;
const splashH = 2778;

const resizedLogo = await sharp(splashSrc)
  .resize(splashLogoSize, splashLogoSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .flatten({ background: { r: 255, g: 255, b: 255 } })
  .toBuffer();

await sharp({
  create: {
    width: splashW,
    height: splashH,
    channels: 3,
    background: { r: 255, g: 255, b: 255 },
  },
})
  .composite([{
    input: resizedLogo,
    left: Math.round((splashW - splashLogoSize) / 2),
    top: Math.round((splashH - splashLogoSize) / 2),
  }])
  .toFile(out('splash.png'));
console.log('✅  splash.png (1284×2778, white bg, centered logo, from logo.png)');
