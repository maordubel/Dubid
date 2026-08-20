import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// אין כאן `base` מותאם: האפליקציה יושבת בשורש הדומיין
// (dubid.dubelteam.com), ולכן ברירת המחדל '/' נכונה.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // המנוע והכרטיס נטענים בנפרד מהמעטפת — המסך הראשון קל יותר
        manualChunks: {
          scoring: ['./src/lib/scoring/engine.ts'],
          sharecard: ['./src/lib/shareCard.ts', './src/lib/qr.ts'],
        },
      },
    },
  },
  server: { port: 5173, host: true },
  preview: { port: 4173 },
});
