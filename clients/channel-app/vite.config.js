import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    uni(),
  ],
  server: {
    host: '127.0.0.1',
    port: 4313,
    proxy: {
      '/api': 'http://127.0.0.1:4312',
      '/console': 'http://127.0.0.1:4312',
      '/media': 'http://127.0.0.1:4312',
    },
  },
})
