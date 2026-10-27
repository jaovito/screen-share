import type { ProductUser, RoomSnapshot, RoomSummary } from '@screen-share/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ProductApi, ProductApiError } from '../services/product-api';

type ProductState = {
  phase: 'loading' | 'ready' | 'offline';
  user: ProductUser | null;
  rooms: RoomSummary[];
  snapshot: RoomSnapshot | null;
};
const initial: ProductState = { phase: 'loading', user: null, rooms: [], snapshot: null };

export function useProductSession(api: ProductApi) {
  const [state, setState] = useState<ProductState>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const selectedRef = useRef(selected);
  const mounted = useRef(true);
  selectedRef.current = selected;

  const refresh = useCallback(async () => {
    const attempt = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const user = await api.session(controller.signal);
      const rooms = user ? await api.rooms(controller.signal) : [];
      const id = selectedRef.current;
      const snapshot =
        user && id && rooms.some((room) => room.id === id)
          ? await api.room(id, controller.signal)
          : null;

      if (mounted.current && attempt === generation.current) {
        if (id && !rooms.some((room) => room.id === id)) {
          selectedRef.current = null;
          setSelected(null);
        }
        setState({ phase: 'ready', user, rooms, snapshot });
      }
    } catch {
      if (mounted.current && attempt === generation.current) {
        // An unknown authorization state immediately unmounts all media owners.
        setState((previous) => ({ ...previous, phase: 'offline', snapshot: null }));
      }
    } finally {
      clearTimeout(timeout);
    }
  }, [api]);

  useEffect(() => {
    selectedRef.current = selected;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (!mutation.current) await refresh();
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    void poll();

    return () => {
      stopped = true;
      generation.current++;
      clearTimeout(timer);
      request.current?.abort();
    };
  }, [refresh, selected]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      request.current?.abort();
      mutation.current?.abort();
    };
  }, []);

  async function perform<T>(
    action: (signal: AbortSignal) => Promise<T>,
    apply?: (value: T) => void,
  ) {
    if (mutation.current) return;

    request.current?.abort();
    generation.current++;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setError(false);
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const value = await action(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;

      apply?.(value);
      await refresh();
      return value;
    } catch (failure) {
      if (mounted.current) {
        setError(true);
        if (failure instanceof ProductApiError && failure.status === 401) {
          setState({ ...initial, phase: 'ready' });
        }
      }
    } finally {
      clearTimeout(timeout);
      mutation.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  function select(id: string | null) {
    request.current?.abort();
    generation.current++;
    setState((previous) => ({ ...previous, snapshot: null }));
    selectedRef.current = id;
    setSelected(id);
    setError(false);
  }

  return { ...state, selected, busy, error, select, perform, refresh };
}

export type ProductSessionController = ReturnType<typeof useProductSession>;
