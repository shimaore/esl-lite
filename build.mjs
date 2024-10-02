import esbuild from 'esbuild'

esbuild.build({
  entryPoints: ['src/esl-lite.ts'],
  bundle: true,
  format: 'cjs',
  outfile: 'esl-lite.cjs',
  platform: 'node',
  target: 'node22',
})

esbuild.build({
  entryPoints: ['src/esl-lite.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'esl-lite.mjs',
  platform: 'node',
  target: 'node22',
})
