import { useEffect, useState } from 'react';
import { type ControlState, readControlState } from '../services/control-api';

export function useControlConnection() {
  const [connection, setConnection] = useState<ControlState>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setConnection({ state: 'unavailable' });
      controller.abort();
    }, 5000);

    setConnection({ state: 'loading' });

    void readControlState(controller.signal, attempt > 0)
      .then((result) => {
        if (!controller.signal.aborted) setConnection(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setConnection({ state: 'unavailable' });
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  return { connection, retry: () => setAttempt((value) => value + 1) };
}
