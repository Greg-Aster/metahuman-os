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
      borderColor: {
        'light': 'rgba(0, 0, 0, 0.1)',
        'dark': 'rgba(255, 255, 255, 0.1)',
      },
      backgroundColor: {
        'overlay-light': 'rgba(255, 255, 255, 0.05)',
        'overlay-dark': 'rgba(0, 0, 0, 0.05)',
      },
    },
  },
  plugins: [],
};
