import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  base: '/bflow-modeler/',
  plugins: [react()],
  assetsInclude: ['**/*.png', '**/*.bpmn', '**/*.jpeg', '**/*.gif', '**/*.svg', '**/*.ico', '**/*.webp'],
})
