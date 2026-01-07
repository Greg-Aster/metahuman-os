#!/usr/bin/env npx tsx
/**
 * CSS Audit Script
 * Scans all Svelte files and reports inline CSS line counts.
 * Flags files that exceed the 50-line threshold defined in CLAUDE.md.
 *
 * Usage: npx tsx scripts/audit-css.ts
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

interface FileReport {
  path: string;
  cssLines: number;
  hasGlobalDark: boolean;
  hardcodedColors: number;
  status: 'ok' | 'warn' | 'critical';
}

const THRESHOLD_WARN = 50;
const THRESHOLD_CRITICAL = 150;

// Hardcoded color patterns to detect
const HARDCODED_COLOR_PATTERNS = [
  /#[0-9a-fA-F]{3,8}\b/g,  // Hex colors
  /rgba?\([^)]+\)/g,       // rgb/rgba
  /hsla?\([^)]+\)/g,       // hsl/hsla
];

function findSvelteFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip node_modules and hidden directories
      if (!entry.startsWith('.') && entry !== 'node_modules') {
        findSvelteFiles(fullPath, files);
      }
    } else if (entry.endsWith('.svelte')) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractStyleBlock(content: string): string | null {
  const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  return styleMatch ? styleMatch[1] : null;
}

function countHardcodedColors(css: string): number {
  let count = 0;
  for (const pattern of HARDCODED_COLOR_PATTERNS) {
    const matches = css.match(pattern);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

function analyzeFile(filePath: string, rootDir: string): FileReport {
  const content = readFileSync(filePath, 'utf-8');
  const styleBlock = extractStyleBlock(content);

  const relativePath = relative(rootDir, filePath);

  if (!styleBlock) {
    return {
      path: relativePath,
      cssLines: 0,
      hasGlobalDark: false,
      hardcodedColors: 0,
      status: 'ok'
    };
  }

  const lines = styleBlock.split('\n').filter(line => line.trim().length > 0);
  const cssLines = lines.length;
  const hasGlobalDark = styleBlock.includes(':global(.dark)');
  const hardcodedColors = countHardcodedColors(styleBlock);

  let status: 'ok' | 'warn' | 'critical' = 'ok';
  if (cssLines >= THRESHOLD_CRITICAL) {
    status = 'critical';
  } else if (cssLines >= THRESHOLD_WARN) {
    status = 'warn';
  }

  return {
    path: relativePath,
    cssLines,
    hasGlobalDark,
    hardcodedColors,
    status
  };
}

function main() {
  const rootDir = process.cwd();
  const siteDir = join(rootDir, 'apps/site/src');

  console.log('\n🎨 CSS Audit Report\n');
  console.log('='.repeat(80));
  console.log(`Scanning: ${siteDir}`);
  console.log(`Thresholds: warn ≥${THRESHOLD_WARN} lines, critical ≥${THRESHOLD_CRITICAL} lines\n`);

  const files = findSvelteFiles(siteDir);
  const reports: FileReport[] = [];

  for (const file of files) {
    const report = analyzeFile(file, rootDir);
    reports.push(report);
  }

  // Sort by CSS lines descending
  reports.sort((a, b) => b.cssLines - a.cssLines);

  // Summary stats
  const critical = reports.filter(r => r.status === 'critical');
  const warnings = reports.filter(r => r.status === 'warn');
  const ok = reports.filter(r => r.status === 'ok');
  const totalCssLines = reports.reduce((sum, r) => sum + r.cssLines, 0);
  const totalHardcoded = reports.reduce((sum, r) => sum + r.hardcodedColors, 0);

  // Print critical files
  if (critical.length > 0) {
    console.log('🚨 CRITICAL (≥150 lines) - Refactor immediately:\n');
    for (const r of critical) {
      console.log(`   ${r.cssLines.toString().padStart(4)} lines  ${r.path}`);
      if (r.hasGlobalDark) console.log(`          └─ Uses :global(.dark) pattern (should use Tailwind dark:)`);
      if (r.hardcodedColors > 10) console.log(`          └─ ${r.hardcodedColors} hardcoded colors detected`);
    }
    console.log('');
  }

  // Print warnings
  if (warnings.length > 0) {
    console.log('⚠️  WARNING (≥50 lines) - Consider refactoring:\n');
    for (const r of warnings) {
      console.log(`   ${r.cssLines.toString().padStart(4)} lines  ${r.path}`);
    }
    console.log('');
  }

  // Print summary
  console.log('='.repeat(80));
  console.log('\n📊 Summary:\n');
  console.log(`   Total files scanned:     ${reports.length}`);
  console.log(`   Total inline CSS lines:  ${totalCssLines}`);
  console.log(`   Hardcoded colors:        ${totalHardcoded}`);
  console.log('');
  console.log(`   🟢 OK (<50 lines):       ${ok.length} files`);
  console.log(`   🟡 Warning (50-149):     ${warnings.length} files`);
  console.log(`   🔴 Critical (≥150):      ${critical.length} files`);
  console.log('');

  // Top 10 offenders
  console.log('📋 Top 10 files by inline CSS:\n');
  for (const r of reports.slice(0, 10)) {
    const icon = r.status === 'critical' ? '🔴' : r.status === 'warn' ? '🟡' : '🟢';
    console.log(`   ${icon} ${r.cssLines.toString().padStart(4)} lines  ${r.path}`);
  }
  console.log('');

  // Exit with error code if critical issues exist
  if (critical.length > 0) {
    console.log('❌ CSS audit failed - critical issues found\n');
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log('⚠️  CSS audit passed with warnings\n');
    process.exit(0);
  } else {
    console.log('✅ CSS audit passed\n');
    process.exit(0);
  }
}

main();
