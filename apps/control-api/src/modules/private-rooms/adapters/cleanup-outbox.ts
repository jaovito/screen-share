import type pg from 'pg';

/** Claim durably, release SQL locks before RTC I/O, then acknowledge under the
 * same room-first lock ordering used by membership/session transactions. */
export function createCleanupProcessor(pool: pg.Pool) {
  return async (remove: (rtcRoom: string) => Promise<void>) => {
    const result = await pool.query<{
      id: string;
      roomId: string;
      sessionId: string;
      rtcRoom: string;
      attempts: number;
    }>(`
      UPDATE rtc_cleanup_outbox SET attempts=attempts+1,available_at=now()+interval '15 seconds'
      WHERE id=(SELECT id FROM rtc_cleanup_outbox WHERE completed_at IS NULL AND available_at<=now()
      ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id,room_id AS "roomId",session_id AS "sessionId",rtc_room AS "rtcRoom",attempts`);
    const job = result.rows[0];
    if (!job) return 0;

    try {
      await remove(job.rtcRoom);
    } catch {
      const delay = Math.min(60, 2 ** Math.min(job.attempts, 6));
      await pool.query(
        "UPDATE rtc_cleanup_outbox SET available_at=now()+($3::int * interval '1 second') WHERE id=$1 AND attempts=$2 AND completed_at IS NULL",
        [job.id, job.attempts, delay],
      );
      return 1;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM private_rooms WHERE id=$1 FOR UPDATE', [job.roomId]);
      await client.query(
        "UPDATE media_sessions SET state=CASE WHEN state='abandoned' THEN state ELSE 'closed' END WHERE id=$1",
        [job.sessionId],
      );
      await client.query(
        'UPDATE rtc_cleanup_outbox SET completed_at=now() WHERE id=$1 AND attempts=$2',
        [job.id, job.attempts],
      );
      await client.query(
        "UPDATE private_rooms SET state='idle' WHERE id=$1 AND state='closing' AND NOT EXISTS(SELECT 1 FROM rtc_cleanup_outbox WHERE room_id=$1 AND completed_at IS NULL)",
        [job.roomId],
      );
      await client.query('COMMIT');
      return 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
}
