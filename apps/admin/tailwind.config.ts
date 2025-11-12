import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  // Theme configuration has been moved to CSS (globals.css) using @theme directive
  // This config file is now minimal and mainly used for plugins
  plugins: [require("tailwindcss-animate")],
}

export default config
