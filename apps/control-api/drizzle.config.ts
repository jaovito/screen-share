import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: '@modules/rooms/adapters/schema',
  out: './drizzle',
});
