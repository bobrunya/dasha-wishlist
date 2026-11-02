import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// На GitHub Pages сайт живёт по адресу https://<логин>.github.io/<репозиторий>/
// Базовый путь задаётся переменной VITE_BASE (в GitHub Actions — автоматически).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
})
