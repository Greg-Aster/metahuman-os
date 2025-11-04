/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/**/*.{astro,html,js,jsx,ts,tsx,svelte,md,mdx}',
    '../../{AGENTS.md,ARCHITECTURE.md,CLAUDE.md,DESIGN.md,GEMINI.md,MORNING_GAMEPLAN.md,NEXT_STEPS.md,README.md}',
    '../../docs/**/*.{md,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#7c3aed',
          dark: '#a78bfa',
        },
      },
    },
  },
  plugins: [],
};
