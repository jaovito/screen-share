import { useAppInfo } from '../../hooks/use-app-info';

export function ControlPage() {
  const { info, error } = useAppInfo();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header>
        <div className="brand">
          <span className="mark" aria-hidden="true">
            ↗
          </span>{' '}
          screen share
        </div>
        <span className="badge">Cliente desktop · M0</span>
      </header>
      <div className="eyebrow">Compartilhar, com intenção</div>
      <h1>O começo da sua transmissão.</h1>
      <p>
        O cliente está em construção. A captura nativa no Windows e o transporte WebRTC serão
        validados na próxima etapa.
      </p>
      <div className="layout">
        <section className="panel player">
          <span className="screen" aria-hidden="true">
            ▣
          </span>
          <h2>Nenhuma fonte selecionada</h2>
          <p>Captura e transmissão ainda não implementadas.</p>
          <button type="button" disabled>
            Iniciar transmissão
          </button>
        </section>
        <aside className="panel">
          <h2>Estado do aplicativo</h2>
          {error ? (
            <p role="status">{error}</p>
          ) : info ? (
            <dl className="details">
              <dt>Versão</dt>
              <dd>{info.version}</dd>
              <dt>Plataforma</dt>
              <dd>{info.platform}</dd>
              <dt>Motor de mídia</dt>
              <dd>
                {info.mediaStatus === 'unsupported_platform'
                  ? 'Plataforma sem suporte'
                  : 'Ainda não implementado'}
              </dd>
            </dl>
          ) : (
            <p role="status">Consultando o shell…</p>
          )}
          <p className="notice">Sem sessão de mídia, métricas ou criptografia ativa.</p>
        </aside>
      </div>
      <footer>
        Windows 11 x64 é a plataforma prevista para transmissão. Nenhuma captura é iniciada
        automaticamente.
      </footer>
    </main>
  );
}
