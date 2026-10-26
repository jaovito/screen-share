import { expect, it, mock } from 'bun:test';
import { createRoot } from 'react-dom/client';

mock.module('react-dom/client', () => ({ createRoot: mock(() => ({ render: mock() })) }));

it('mounts React and fails explicitly when the root is missing', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  await import('./main');
  expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'));

  document.body.innerHTML = '';
  const missingRootModule = './main?missing-root';
  await expect(import(missingRootModule)).rejects.toThrow('Elemento raiz ausente');
});
