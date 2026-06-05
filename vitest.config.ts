import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      maxWorkers: 1,
      isolate: false,
      fileParallelism: false,
    },
  }),
);
