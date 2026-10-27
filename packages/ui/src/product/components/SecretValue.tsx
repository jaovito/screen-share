import { useState } from 'react';
import { useProductMessages } from '../locales';

export function SecretValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'copyFailed'>('idle');
  const t = useProductMessages();

  return (
    <div className="secret-value">
      <label>
        {label}
        <input
          type="password"
          value={value}
          readOnly
          autoComplete="off"
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => setCopied('copied'))
            .catch(() => setCopied('copyFailed'));
          if (!navigator.clipboard) setCopied('copyFailed');
        }}
      >
        {t('copySecret')}
      </button>
      {copied !== 'idle' && <span role="status">{t(copied)}</span>}
    </div>
  );
}
