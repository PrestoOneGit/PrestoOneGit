import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Build « un seul fichier » : tout (JS, CSS, worker) est inliné dans
// index.html pour distribuer l'app comme une simple page autonome.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { outDir: 'dist-single' },
})
