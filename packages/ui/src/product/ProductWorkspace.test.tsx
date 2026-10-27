import { afterEach, beforeEach, expect, it, mock } from 'bun:test';
import { localeStorageKey } from '@screen-share/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProductServer, roomId, sessionId } from './fixtures.test';
import { ProductWorkspace } from './ProductWorkspace';

const secureDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
beforeEach(() => {
  localStorage.setItem(localeStorageKey, 'en');
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
});
afterEach(() => {
  if (secureDescriptor) Object.defineProperty(globalThis, 'isSecureContext', secureDescriptor);
  else Reflect.deleteProperty(globalThis, 'isSecureContext');
});

async function openRoom() {
  fireEvent.click(await screen.findByRole('button', { name: /Friday games/ }));
  await screen.findByRole('heading', { name: 'Friday games' });
}

it('signs in and creates accounts without retaining the submitted password, then signs out', async () => {
  const server = new ProductServer();
  server.user = null;
  server.hasRoom = false;
  render(<ProductWorkspace apiUrl="https://control.example.test" control={server.control} />);
  const password = await screen.findByLabelText('Password');
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.test' } });
  fireEvent.change(password, { target: { value: 'synthetic-password-only' } });
  fireEvent.submit(password.closest('form') ?? password);
  expect((password as HTMLInputElement).value).toBe('');
  await screen.findByRole('heading', { name: 'Your rooms' });
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByLabelText('Password');
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Owner' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'second-synthetic-password' },
  });
  fireEvent.submit(screen.getByLabelText('Password').closest('form') ?? document.body);
  await screen.findByRole('heading', { name: 'Your rooms' });
  expect(server.calls.some((call) => call.path.includes('/sign-up/'))).toBe(true);
  expect(localStorage.getItem('mediaKey')).toBeNull();
});

it('creates and selects rooms, accepts private invitations, and shows owner approval controls', async () => {
  const server = new ProductServer();
  server.hasRoom = false;
  render(<ProductWorkspace apiUrl="https://control.example.test" control={server.control} />);
  const roomName = await screen.findByLabelText('Room name');
  fireEvent.change(roomName, { target: { value: 'Friday games' } });
  fireEvent.submit(roomName.closest('form') ?? document.body);
  await screen.findByRole('heading', { name: 'Friday games' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Remove' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await waitFor(() => expect(screen.queryByText('Viewer')).toBeNull());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Request access' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
  const token = screen.getByLabelText('Private invitation');
  fireEvent.change(token, { target: { value: 'b'.repeat(43) } });
  fireEvent.submit(token.closest('form') ?? document.body);
  expect((token as HTMLInputElement).value).toBe('');
  await waitFor(() =>
    expect(server.calls.some((call) => call.path === '/v1/invites/accept')).toBe(true),
  );
});

it('creates, copies and revokes an invitation without exposing it in URL or storage', async () => {
  const server = new ProductServer();
  const writeText = mock(async (_value: string) => {});
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const view = render(
    <ProductWorkspace apiUrl="https://control.example.test" control={server.control} />,
  );
  try {
    await openRoom();
    fireEvent.change(screen.getByLabelText('Expires in minutes'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Maximum requests'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    await screen.findByText('Invitation created. Share it privately; it is displayed only now.');
    fireEvent.click(screen.getByRole('button', { name: 'Copy privately' }));
    await screen.findByText('Copied');
    expect(writeText).toHaveBeenCalledWith('b'.repeat(43));
    expect(window.location.href).not.toContain('b'.repeat(43));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke invitation' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Revoke invitation' })).toBeNull(),
    );
  } finally {
    view.unmount();
    if (previous) Object.defineProperty(navigator, 'clipboard', previous);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it('prepares a session with a local independent key and requires manual delivery before activation', async () => {
  const server = new ProductServer();
  render(<ProductWorkspace apiUrl="https://control.example.test" control={server.control} />);
  await openRoom();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare sharing' }));
  const key = await screen.findByLabelText('Content key');
  expect((key as HTMLInputElement).value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const activate = screen.getByRole('button', { name: 'Open session to approved viewers' });
  expect(activate.hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: /Activate only after/ }));
  fireEvent.click(activate);
  await screen.findByText(
    'Publishing requires the Windows desktop app. This browser can receive an approved stream.',
  );
  expect(
    screen.getByRole('button', { name: 'Choose window and start' }).hasAttribute('disabled'),
  ).toBe(true);
  expect(JSON.stringify(server.calls)).not.toContain((key as HTMLInputElement).value);
  fireEvent.click(screen.getByRole('button', { name: 'End session' }));
  await waitFor(() => expect(screen.queryByLabelText('Content key')).toBeNull());
});

it('shows pending approval, localized copy, authentication failures and a recoverable offline state', async () => {
  const server = new ProductServer();
  server.current.room.membership = 'pending';
  const view = render(
    <ProductWorkspace apiUrl="https://control.example.test" control={server.control} />,
  );
  await openRoom();
  expect(screen.getByRole('status').textContent).toContain('Waiting for owner approval');
  fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'es' } });
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Una pantalla. Tu gente.');
  view.unmount();
  server.fail = true;
  render(<ProductWorkspace apiUrl="https://control.example.test" control={server.control} />);
  await screen.findByRole('alert');
  server.fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByRole('heading', { name: 'Tus salas' });
  expect(server.calls.some((call) => call.path === `/v1/rooms/${roomId}`)).toBe(true);
});

it('clears invalidated authentication after a denied mutation and allows retrying unavailable secure key generation', async () => {
  const server = new ProductServer();
  const control = mock(server.control);
  const view = render(<ProductWorkspace apiUrl="https://control.example.test" control={control} />);
  await openRoom();
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare sharing' }));
  await screen.findByText('A secure browser context with cryptographic randomness is required.');
  expect(screen.queryByLabelText('Content key')).toBeNull();
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  fireEvent.click(screen.getByRole('button', { name: 'Generate fresh key' }));
  expect((screen.getByLabelText('Content key') as HTMLInputElement).value).toMatch(
    /^[A-Za-z0-9_-]{43}$/,
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'End session' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
  control.mockResolvedValueOnce({ status: 401, body: { error: 'unauthorized' } });
  fireEvent.click(screen.getByRole('button', { name: 'End session' }));
  await screen.findByLabelText('Password');
  expect(screen.queryByLabelText('Content key')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('The request could not be completed.');
  view.unmount();
});

it('lists persisted invitation metadata after reload and revokes older invitations without their secret', async () => {
  const server = new ProductServer();
  const invitation = {
    id: '55555555-5555-4555-8555-555555555555',
    expiresAt: '2026-10-28T00:00:00.000Z',
    maxUses: 2,
    uses: 1,
    revoked: false,
  };
  const control: typeof server.control = async (request) => {
    if (request.path.endsWith('/invites') && request.method === 'GET')
      return { status: 200, body: { invites: [invitation] } };
    if (request.path.includes('/invites/') && request.method === 'DELETE')
      invitation.revoked = true;
    return server.control(request);
  };
  const view = render(<ProductWorkspace apiUrl="https://control.example.test" control={control} />);
  await openRoom();
  await screen.findByText('1 of 2 requests used');
  fireEvent.click(screen.getByRole('button', { name: 'Revoke invitation' }));
  await screen.findByText('1 of 2 requests used · Revoked');
  expect(screen.queryByLabelText('Content key')).toBeNull();
  expect(JSON.stringify(invitation)).not.toContain('token');
  view.unmount();
  render(<ProductWorkspace apiUrl="https://control.example.test" control={control} />);
  await openRoom();
  await screen.findByText('1 of 2 requests used · Revoked');
  expect(screen.queryByRole('button', { name: 'Revoke invitation' })).toBeNull();
});

it('explains a lost active-session key after reload and recovers only through a new explicitly prepared session', async () => {
  const server = new ProductServer();
  server.current.room.state = 'active';
  server.current.session = {
    id: sessionId,
    epoch: 1,
    membershipRevision: 1,
    publisherId: server.current.room.ownerId,
    state: 'active',
    createdAt: server.current.room.createdAt,
  };
  render(<ProductWorkspace apiUrl="https://control.example.test" control={server.control} />);
  await openRoom();
  await screen.findByText(/The content key was cleared when this page was reloaded/);
  expect(screen.queryByLabelText('Content key')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Choose window and start' }).hasAttribute('disabled'),
  ).toBe(true);
  expect(server.calls.some((call) => call.path.endsWith('/grants'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'End session' }));
  await waitFor(() => expect(screen.queryByText(/The content key was cleared/)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Prepare sharing' }));
  const key = await screen.findByLabelText('Content key');
  expect((key as HTMLInputElement).value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(
    screen
      .getByRole('button', { name: 'Open session to approved viewers' })
      .hasAttribute('disabled'),
  ).toBe(true);
});
