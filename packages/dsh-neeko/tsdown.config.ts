import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/startup.ts', 'src/protocol.ts'],
  clean: true,
  dts: true,
  fixedExtension: false,
  format: 'esm',
  outDir: 'lib',
  platform: 'node',
})
