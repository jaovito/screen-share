import { beforeEach, expect, it, mock } from 'bun:test';
import { LocaleProvider } from '@screen-share/i18n';
import type { ReceptionState } from '@screen-share/rtc-browser';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { viewerTranslations } from '../../locales';

const stop = mock(() => {});
const receive = mock(
  (settings: {
    grant: unknown;
    mediaKey: string;
    video: HTMLVideoElement;
    onState: (state: ReceptionState) => void;
  }) => {
    settings.onState(settings.grant === null ? 'invalidGrant' : 'connecting');
    return { stop };
  },
);

mock.module('@screen-share/rtc-browser', () => ({ receiveEncryptedSession: receive }));

const { EncryptedSessionPanel } = await import('./index');

function setup() {
  return render(
    <LocaleProvider translations={viewerTranslations} titleKey="documentTitle">
      <EncryptedSessionPanel />
    </LocaleProvider>,
  );
}

async function toggle(container: HTMLElement, open: boolean) {
  const details = container.querySelector('details');
  if (!details) throw new Error('Expected an opt-in details panel');
  await act(async () => {
    details.open = open;
    fireEvent(details, new Event('toggle'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  stop.mockClear();
  receive.mockClear();
});

it('requires explicit expansion and consent, clears secrets after submit, and disconnects explicitly', async () => {
  const view = setup();
  expect(screen.queryByLabelText('Chave de mídia independente')).toBeNull();
  expect(receive).not.toHaveBeenCalled();
  await toggle(view.container, true);

  const grant = await screen.findByLabelText('Autorização de espectador JSON');
  const key = screen.getByLabelText('Chave de mídia independente');
  const connect = screen.getByRole('button', { name: 'Conectar à prova' });
  expect(connect.hasAttribute('disabled')).toBe(true);
  fireEvent.change(grant, { target: { value: '{"synthetic":"grant"}' } });
  fireEvent.change(key, { target: { value: 'a'.repeat(43) } });
  const form = view.container.querySelector('form');
  if (!form) throw new Error('Expected a proof form');
  fireEvent.submit(form);
  expect(receive).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(connect);
  fireEvent.submit(form);
  expect('value' in grant && grant.value).toBe('');
  expect('value' in key && key.value).toBe('');
  await act(async () => {
    await Promise.resolve();
  });

  expect(receive).toHaveBeenCalledTimes(1);
  expect(receive).toHaveBeenCalledWith(
    expect.objectContaining({ grant: { synthetic: 'grant' }, mediaKey: 'a'.repeat(43) }),
  );
  expect(grant.getAttribute('autocomplete')).toBe('off');
  expect(key.getAttribute('type')).toBe('password');
  expect('value' in grant && grant.value).toBe('');
  expect('value' in key && key.value).toBe('');
  expect(localStorage.length).toBe(1);
  expect(localStorage.getItem('screen-share.locale')).toBe('pt-BR');
  expect(screen.getByRole('status').textContent).toContain('Configurando');
  fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toContain('Desconectado');
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});

it('handles malformed grant input without leaking it and stops ownership on collapse and unmount', async () => {
  const view = setup();
  await toggle(view.container, true);
  fireEvent.change(await screen.findByLabelText('Autorização de espectador JSON'), {
    target: { value: 'private malformed input' },
  });
  fireEvent.change(screen.getByLabelText('Chave de mídia independente'), {
    target: { value: 'a'.repeat(43) },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Conectar à prova' }));
    await Promise.resolve();
  });
  expect(receive).toHaveBeenCalledWith(expect.objectContaining({ grant: null }));
  expect(screen.getByRole('status').textContent).toContain('Autorização inválida');
  expect(document.body.textContent).not.toContain('private malformed input');
  await toggle(view.container, false);
  expect(stop).toHaveBeenCalledTimes(1);
  await toggle(view.container, true);
  await screen.findByLabelText('Autorização de espectador JSON');
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});

it('renders translated proof labels and notices in the selected locale', async () => {
  localStorage.setItem('screen-share.locale', 'en');
  const view = setup();
  await toggle(view.container, true);
  await screen.findByLabelText('Independent media key');
  expect(screen.getByRole('status').textContent).toContain('Disconnected');
  expect(screen.getByText(/Obtain an expiring viewer grant/)).toBeTruthy();
  view.unmount();
});

it('cancels a pending lazy import on unmount before starting any media resources', async () => {
  const view = setup();
  await toggle(view.container, true);
  fireEvent.change(await screen.findByLabelText('Autorização de espectador JSON'), {
    target: { value: '{"synthetic":"grant"}' },
  });
  fireEvent.change(screen.getByLabelText('Chave de mídia independente'), {
    target: { value: 'a'.repeat(43) },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Conectar à prova' }));
    view.unmount();
    await Promise.resolve();
  });
  expect(receive).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
});

it('sanitizes lazy connection failures and ignores callbacks after explicit disconnection', async () => {
  const view = setup();
  await toggle(view.container, true);
  const grant = await screen.findByLabelText('Autorização de espectador JSON');
  const key = screen.getByLabelText('Chave de mídia independente');
  const submit = async () => {
    fireEvent.change(grant, { target: { value: '{"synthetic":"grant"}' } });
    fireEvent.change(key, { target: { value: 'a'.repeat(43) } });
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Conectar à prova' }));
      await Promise.resolve();
    });
  };
  receive.mockImplementationOnce(() => {
    throw new Error('private SDK exception');
  });
  await submit();
  expect(screen.getByRole('status').textContent).toContain('Recepção interrompida');
  expect(document.body.textContent).not.toContain('private SDK exception');
  await submit();
  const onState = receive.mock.calls.at(-1)?.[0].onState;
  fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
  await act(async () => onState?.('subscribed'));
  expect(screen.getByRole('status').textContent).toContain('Desconectado');
  view.unmount();
});
