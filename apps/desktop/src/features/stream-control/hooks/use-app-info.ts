import type { AppInfoDto } from '@screen-share/contracts';
import { useEffect, useState } from 'react';
import { readAppInfo } from '../services/app-info';

export function useAppInfo() {
  const [info, setInfo] = useState<AppInfoDto | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    void readAppInfo()
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch(() => {
        if (active) setError(true);
      });

    return () => {
      active = false;
    };
  }, []);

  return { info, error };
}
