import { ProductWorkspace } from '@screen-share/ui/product';
import { desktopControl, desktopPublisher } from '../../services/publisher';
import { desktopUpdater } from '../../services/updates';

export function ProductPage() {
  return (
    <ProductWorkspace
      apiUrl={import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3000'}
      publisher={desktopPublisher()}
      control={desktopControl()}
      updater={desktopUpdater()}
    />
  );
}
