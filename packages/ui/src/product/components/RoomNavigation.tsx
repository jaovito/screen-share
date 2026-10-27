import type { ProductSessionController } from '../hooks/use-product-session';
import { useProductMessages } from '../locales';
import type { ProductApi } from '../services/product-api';

export function RoomNavigation({
  api,
  controller,
}: {
  api: ProductApi;
  controller: ProductSessionController;
}) {
  const t = useProductMessages();

  return (
    <aside className="panel room-navigation">
      <h2>{t('rooms')}</h2>
      <nav aria-label={t('rooms')}>
        {controller.rooms.map((room) => (
          <button
            key={room.id}
            type="button"
            className={`room-link ${controller.selected === room.id ? 'selected' : ''}`}
            onClick={() => controller.select(room.id)}
            disabled={controller.busy}
          >
            <strong>{room.name}</strong>
            <span>
              {t(
                room.membership === 'pending'
                  ? 'pending'
                  : room.membership === 'owner'
                    ? 'owner'
                    : 'member',
              )}
            </span>
          </button>
        ))}
      </nav>
      {controller.rooms.length === 0 && <p>{t('noRooms')}</p>}
      <form
        className="product-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const name = String(data.get('roomName'));
          event.currentTarget.reset();
          void controller.perform(
            (signal) => api.createRoom(name, signal),
            (snapshot) => controller.select(snapshot.room.id),
          );
        }}
      >
        <label>
          {t('roomName')}
          <input name="roomName" required maxLength={80} />
        </label>
        <button type="submit" disabled={controller.busy}>
          {t('createRoom')}
        </button>
      </form>
      <form
        className="product-form invite-request"
        onSubmit={(event) => {
          event.preventDefault();
          const token = String(new FormData(event.currentTarget).get('invite'));
          event.currentTarget.reset();
          void controller.perform(
            (signal) => api.acceptInvite(token, signal),
            (accepted) => controller.select(accepted.roomId),
          );
        }}
      >
        <label>
          {t('inviteToken')}
          <input
            name="invite"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            minLength={43}
            maxLength={43}
          />
        </label>
        <button type="submit" className="secondary" disabled={controller.busy}>
          {t('acceptInvite')}
        </button>
        <p className="notice">{t('inviteNotice')}</p>
      </form>
    </aside>
  );
}
