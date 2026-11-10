import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['docs/verification/model-settings-20261109/live.test.ts'],exclude:[],maxWorkers:1}});
