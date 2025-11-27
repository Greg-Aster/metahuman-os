import { vitePreprocess } from '@astrojs/svelte';

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Ensure components are compiled for DOM (hydratable)
    hydratable: true,
  }
};
