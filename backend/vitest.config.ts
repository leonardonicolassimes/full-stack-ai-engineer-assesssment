import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  test: {
    env: { ...loadEnv(mode, '..', ''), NODE_ENV: 'test', LLM_PROVIDER: 'mock', MOCK_DELAY_MS: '0' },
    fileParallelism: false,
  },
}));
