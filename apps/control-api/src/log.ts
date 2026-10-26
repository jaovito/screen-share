export function log(event: string, fields: Record<string, string | number | boolean> = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));
}
