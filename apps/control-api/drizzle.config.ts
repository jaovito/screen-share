import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/modules/rooms/adapters/schema.ts',
    './src/modules/identity/adapters/schema.ts',
    './src/modules/private-rooms/adapters/schema.ts',
  ],
  out: './drizzle',
});
