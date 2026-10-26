export interface ReadinessPort {
  check(): Promise<void>;
}

export async function isReady(database: ReadinessPort): Promise<boolean> {
  try {
    await database.check();

    return true;
  } catch {
    return false;
  }
}
