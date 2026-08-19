import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `--expose-gc` so the memory regression tests (session-transcript.test.ts)
    // can settle the heap before measuring. Without it `global.gc` is undefined
    // and those assertions would be measuring uncollected garbage rather than
    // what the reader RETAINS, which is the property that matters: the readers
    // exist so a 2 GB sessions directory costs tens of MB, not gigabytes.
    poolOptions: {
      forks: { execArgv: ['--expose-gc'] },
      threads: { execArgv: ['--expose-gc'] },
    },
  },
});
