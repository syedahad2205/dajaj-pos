#!/usr/bin/env node
/**
 * Generates DAJAJ brand app icons for Android.
 * Creates PNG files with: red (#d43f2f) rounded-rect background, white "D" text.
 * Pure Node.js — no external dependencies.
 * Uses the PNG chunk format directly.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// DAJAJ brand red from logo
const BRAND_RED = [0xd4, 0x3f, 0x2f, 0xff];  // #d43f2f
const WHITE = [0xff, 0xff, 0xff, 0xff];
const TRANSPARENT = [0x00, 0x00, 0x00, 0x00];

function crc32(buf) {
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, t, data, crc]);
}

function makePNG(size) {
  const w = size, h = size;
  // RGBA pixel data
  const pixels = new Uint8Array(w * h * 4);
  
  const cornerR = Math.round(size * 0.22);  // ~22% corner radius (matches DajajLogo)
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      
      // Check if inside rounded rect
      const inRRect = isInRoundedRect(x, y, 0, 0, w, h, cornerR);
      
      if (!inRRect) {
        // Transparent outside
        pixels[idx] = 0; pixels[idx+1] = 0; pixels[idx+2] = 0; pixels[idx+3] = 0;
      } else {
        // Brand red background
        pixels[idx] = BRAND_RED[0];
        pixels[idx+1] = BRAND_RED[1];
        pixels[idx+2] = BRAND_RED[2];
        pixels[idx+3] = BRAND_RED[3];
      }
    }
  }
  
  // Draw "D" letter — bitmap font scaled to icon
  const letterSize = Math.round(size * 0.55);
  const letterX = Math.round(size * 0.24);
  const letterY = Math.round(size * 0.22);
  drawD(pixels, w, h, letterX, letterY, letterSize);
  
  // Build PNG
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  
  // Raw image data with filter bytes
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = y * (1 + w * 4) + 1 + x * 4;
      raw[dst] = pixels[src];
      raw[dst+1] = pixels[src+1];
      raw[dst+2] = pixels[src+2];
      raw[dst+3] = pixels[src+3];
    }
  }
  
  const compressed = zlib.deflateSync(raw);
  
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function isInRoundedRect(x, y, rx, ry, rw, rh, r) {
  // Check if point (x,y) is inside rounded rectangle
  const x1 = rx + r, x2 = rx + rw - r;
  const y1 = ry + r, y2 = ry + rh - r;
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
  if (x < x1 && y < y1) return dist(x, y, x1, y1) <= r;
  if (x >= x2 && y < y1) return dist(x, y, x2, y1) <= r;
  if (x < x1 && y >= y2) return dist(x, y, x1, y2) <= r;
  if (x >= x2 && y >= y2) return dist(x, y, x2, y2) <= r;
  return true;
}

function dist(x, y, cx, cy) {
  return Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
}

function drawD(pixels, w, h, startX, startY, size) {
  // Draw the letter "D" as filled white paths
  // D: vertical stroke on left + semicircle on right
  const sw = Math.max(2, Math.round(size * 0.18));  // stroke width
  const halfH = size / 2;
  const curveW = size * 0.52;
  const curveR = halfH * 0.9;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size * 0.72; x++) {
      const px = startX + x;
      const py = startY + y;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      
      let fill = false;
      
      // Vertical stroke (left side of D)
      if (x < sw) {
        fill = true;
      }
      
      // Top horizontal bar
      if (y < sw && x < curveW) fill = true;
      
      // Bottom horizontal bar
      if (y >= size - sw && x < curveW) fill = true;
      
      // Right curve of D — filled semicircle area
      const cx = sw + curveW * 0.15;
      const cy = halfH;
      if (x >= sw) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= curveR * curveR) fill = true;
      }
      
      if (fill) {
        const idx = (py * w + px) * 4;
        pixels[idx] = WHITE[0];
        pixels[idx+1] = WHITE[1];
        pixels[idx+2] = WHITE[2];
        pixels[idx+3] = WHITE[3];
      }
    }
  }
}

// Android mipmap densities and sizes
const DENSITIES = [
  { dir: 'mipmap-mdpi',    size: 48  },
  { dir: 'mipmap-hdpi',    size: 72  },
  { dir: 'mipmap-xhdpi',   size: 96  },
  { dir: 'mipmap-xxhdpi',  size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];

const resDir = path.join(__dirname, '../android/app/src/main/res');

let count = 0;
for (const { dir, size } of DENSITIES) {
  const png = makePNG(size);
  const dirPath = path.join(resDir, dir);
  fs.mkdirSync(dirPath, { recursive: true });
  // Write as PNG (overwrites existing webp by creating new png files — Android
  // resolves @mipmap/ic_launcher to any supported format in the directory)
  // Also remove old webp files to avoid conflicts
  const webpLauncher = path.join(dirPath, 'ic_launcher.webp');
  const webpRound = path.join(dirPath, 'ic_launcher_round.webp');
  if (fs.existsSync(webpLauncher)) fs.unlinkSync(webpLauncher);
  if (fs.existsSync(webpRound)) fs.unlinkSync(webpRound);
  fs.writeFileSync(path.join(dirPath, 'ic_launcher.png'), png);
  fs.writeFileSync(path.join(dirPath, 'ic_launcher_round.png'), png);
  console.log(`✓ ${dir}/ic_launcher.png (${size}×${size})`);
  count++;
}

console.log(`\nGenerated ${count * 2} icon files.`);
