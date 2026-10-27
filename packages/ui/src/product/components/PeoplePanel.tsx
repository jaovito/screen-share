import type { RoomSnapshot } from '@screen-share/contracts';
import { useEffect, useState } from 'react';
import type { ProductSessionController } from '../hooks/use-product-session';
import { useProductMessages } from '../locales';
import type { ProductApi } from '../services/product-api';
import { SecretValue } from './SecretValue';

type Invite = Awaited<ReturnType<ProductApi['createInvite']>>;

export function PeoplePanel({
  api,
  controller,
  snapshot,
}: {
  api: ProductApi;
  controller: ProductSessionController;
  snapshot: RoomSnapshot;
}) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<ProductApi['invites']>>>([]);
  const [historyError, setHistoryError] = useState(false);
  const t = useProductMessages();
  const owner = snapshot.room.membership === 'owner';
  const roomId = snapshot.room.id;
  const currentInviteId = invite?.id;

  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let stopped = false;
    void api
      .invites(roomId, controller.signal)
      .then((rows) => {
        if (!stopped) {
          setHistory(rows.filter((item) => item.id !== currentInviteId));
          setHistoryError(false);
        }
      })
      .catch(() => {
        if (!stopped) setHistoryError(true);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [api, roomId, owner, currentInviteId]);

  return (
    <section className="panel people-panel">
      <h2>
        {t('members')} <span className="badge">{snapshot.members.length} / 8</span>
      </h2>
      <ul className="people-list">
        {snapshot.members.map((member) => (
          <li key={member.userId}>
            <span>
              <strong>{member.name}</strong>
              <small>
                {t(
                  member.role === 'owner'
                    ? 'owner'
                    : member.status === 'pending'
                      ? 'pending'
                      : 'member',
                )}
              </small>
            </span>
            {owner && member.role !== 'owner' && (
              <div className="product-actions">
                {member.status === 'pending' && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={controller.busy}
                    onClick={() => {
                      void controller.perform((signal) =>
                        api.member(snapshot.room.id, member.userId, true, signal),
                      );
                    }}
                  >
                    {t('approve')}
                  </button>
                )}
                <button
                  type="button"
                  className="secondary danger"
                  disabled={controller.busy}
                  onClick={() => {
                    void controller.perform((signal) =>
                      api.member(snapshot.room.id, member.userId, false, signal),
                    );
                  }}
                >
                  {t('remove')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {owner && (
        <>
          <form
            className="product-form invite-controls"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void controller.perform(
                (signal) =>
                  api.createInvite(
                    snapshot.room.id,
                    Number(data.get('minutes')),
                    Number(data.get('uses')),
                    signal,
                  ),
                setInvite,
              );
            }}
          >
            <label>
              {t('expiresIn')}
              <input name="minutes" type="number" defaultValue={30} min={1} max={1440} required />
            </label>
            <label>
              {t('maxUses')}
              <input name="uses" type="number" defaultValue={1} min={1} max={7} required />
            </label>
            <button type="submit" disabled={controller.busy || snapshot.members.length >= 8}>
              {t('createInvite')}
            </button>
          </form>
          {invite && (
            <div className="private-callout">
              <p>{t('invitationCreated')}</p>
              <SecretValue value={invite.token} label={t('inviteToken')} />
              <button
                type="button"
                className="secondary danger"
                disabled={controller.busy}
                onClick={() => {
                  void controller.perform(
                    (signal) => api.revokeInvite(snapshot.room.id, invite.id, signal),
                    () => setInvite(null),
                  );
                }}
              >
                {t('revokeInvite')}
              </button>
            </div>
          )}
          <h3>{t('invitationHistory')}</h3>
          {historyError && <p className="notice">{t('inviteHistoryUnavailable')}</p>}
          <ul className="people-list">
            {history
              .filter((item) => item.id !== invite?.id)
              .map((item) => (
                <li key={item.id}>
                  <span>
                    <strong>
                      {new Intl.DateTimeFormat(document.documentElement.lang, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(new Date(item.expiresAt))}
                    </strong>
                    <small>
                      {t('invitationUses', { uses: item.uses, max: item.maxUses })}
                      {item.revoked ? ` · ${t('revoked')}` : ''}
                    </small>
                  </span>
                  {!item.revoked && (
                    <button
                      type="button"
                      className="secondary danger"
                      disabled={controller.busy}
                      onClick={() => {
                        void controller.perform(
                          (signal) => api.revokeInvite(roomId, item.id, signal),
                          () =>
                            setHistory((previous) =>
                              previous.map((entry) =>
                                entry.id === item.id ? { ...entry, revoked: true } : entry,
                              ),
                            ),
                        );
                      }}
                    >
                      {t('revokeInvite')}
                    </button>
                  )}
                </li>
              ))}
          </ul>
          <p className="notice">{t('invitePrivacy')}</p>
        </>
      )}
    </section>
  );
}
