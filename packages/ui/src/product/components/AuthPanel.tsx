import { useState } from 'react';
import type { ProductSessionController } from '../hooks/use-product-session';
import { useProductMessages } from '../locales';
import type { ProductApi } from '../services/product-api';

export function AuthPanel({
  api,
  controller,
}: {
  api: ProductApi;
  controller: ProductSessionController;
}) {
  const [signUp, setSignUp] = useState(false);
  const t = useProductMessages();

  return (
    <section className="panel auth-panel" aria-label={t(signUp ? 'signUp' : 'signIn')}>
      <div className="segmented">
        <button
          type="button"
          className={signUp ? 'secondary' : ''}
          onClick={() => setSignUp(false)}
        >
          {t('signIn')}
        </button>
        <button type="button" className={signUp ? '' : 'secondary'} onClick={() => setSignUp(true)}>
          {t('signUp')}
        </button>
      </div>
      <h2>{t(signUp ? 'signUp' : 'signIn')}</h2>
      <form
        className="product-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const credentials = {
            email: String(data.get('email')),
            password: String(data.get('password')),
            name: String(data.get('name') ?? ''),
          };
          form.reset();
          void controller.perform((signal) => api.authenticate(signUp, credentials, signal));
        }}
      >
        {signUp && (
          <label>
            {t('name')}
            <input name="name" autoComplete="nickname" required maxLength={100} />
          </label>
        )}
        <label>
          {t('email')}
          <input name="email" type="email" autoComplete="email" required maxLength={254} />
        </label>
        <label>
          {t('password')}
          <input
            name="password"
            type="password"
            autoComplete={signUp ? 'new-password' : 'current-password'}
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        <button type="submit" disabled={controller.busy}>
          {t(controller.busy ? 'loading' : signUp ? 'signUp' : 'signIn')}
        </button>
      </form>
      <p className="notice">{t('accountNotice')}</p>
    </section>
  );
}
