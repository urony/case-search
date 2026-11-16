import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' + HashRouter: עובד גם ב-GitHub Pages (אתר פרויקט) וגם ב-Firebase Hosting, כולל רענון קישור ישיר.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/rules/**'], environment: 'node' },
});
