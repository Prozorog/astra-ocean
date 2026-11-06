import { goldenSet } from './pass9-harness.mjs';
await goldenSet(process.argv[2] ?? 'baseline');
