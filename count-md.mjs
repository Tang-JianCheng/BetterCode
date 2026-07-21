#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function printHelp() {
  console.log(`usage: node count-md.mjs <file.md>

  Count words, lines, and paragraphs in a markdown file.

  Paragraphs are defined as blocks of non-blank text separated by one or
  more blank lines.`);
}

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
  printHelp();
  process.exit(args.length === 0 ? 1 : 0);
}

const filePath = resolve(args[0]);

let raw;
try {
  raw = readFileSync(filePath, "utf-8");
} catch (err) {
  console.error(`Error: cannot read "${filePath}" — ${err.message}`);
  process.exit(1);
}

// ----- counts -----

// Lines: every line, including blank ones
const lines = raw.split(/\r?\n/);
const lineCount = lines.length;

// Words: split on whitespace, discard empty strings
const wordCount = raw
  .trim()
  .split(/\s+/)
  .filter(Boolean).length;

// Paragraphs: contiguous blocks of non-blank lines
let wasNonBlank = false;
let paragraphCount = 0;
for (const line of lines) {
  const isNonBlank = line.trim().length > 0;
  if (isNonBlank && !wasNonBlank) {
    paragraphCount++;
  }
  wasNonBlank = isNonBlank;
}

console.log(`  Lines:      ${lineCount}`);
console.log(`  Words:      ${wordCount}`);
console.log(`  Paragraphs: ${paragraphCount}`);
