import { ProductWorkspace, type ReceiverAdapter } from '@screen-share/ui/product';

const receive: ReceiverAdapter = async (input) => {
  const { receiveEncryptedSession } = await import('@screen-share/rtc-browser');
  return receiveEncryptedSession(input);
};

export function ProductPage() {
  return (
    <ProductWorkspace
      apiUrl={import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3000'}
      receiver={receive}
    />
  );
}
