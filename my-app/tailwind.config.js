/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/globals.css', // FIX: Forza rebuild Tailwind su save globals.css
  ],
  safelist: [
    // FIX: Evita purge di classi RainbowKit per modal (opzionale ma utile)
    'rainbowkit-modal',
    'rainbowkit-wallet-list',
    'rainbowkit-wallet-item',
    'rainbowkit-wallet-icon',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
