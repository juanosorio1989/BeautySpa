import { defineConfig, mergeConfig } from "vitest/config";
import swc from "unplugin-swc";
import preset from "@beautyspa/config/vitest.preset";

export default mergeConfig(
  preset,
  defineConfig({
    plugins: [swc.vite({ module: { type: "es6" } })],
  }),
);
