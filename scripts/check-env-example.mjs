import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { envSchema } from '../dist/config/env.schema.js';

const schemaKeys = Object.keys(envSchema.shape).sort();
const fileKeys = Object.keys(
  parse(readFileSync(new URL('../.env.example', import.meta.url), 'utf8')),
).sort();

const missing = schemaKeys.filter((k) => !fileKeys.includes(k));
const extra = fileKeys.filter((k) => !schemaKeys.includes(k));

if (missing.length || extra.length) {
  if (missing.length) {
    console.error(`✗ Missing in .env.example: ${missing.join(', ')}`);
  }
  if (extra.length) {
    console.error(`✗ Extra in .env.example (not in schema): ${extra.join(', ')}`);
  }
  process.exit(1);
}

console.log(`✓ .env.example matches schema (${schemaKeys.length} variables)`);
