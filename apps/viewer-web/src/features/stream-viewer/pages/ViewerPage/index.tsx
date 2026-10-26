import { useControlConnection } from '../../hooks/use-control-connection';

export function ViewerPage() {
  const { connection, retry } = useControlConnection();
  const status = {
    loading: 'Conectando à API…',
    ready: 'API conectada · banco pronto',
    unavailable: 'API ou banco indisponível',
    error: 'Resposta da API incompatível',
  }[connection.state];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header>
        <div className="brand">
          <span className="mark" aria-hidden="true">
            ↗
          </span>{' '}
          screen share
        </div>
        <span className="badge">M0 · Fundação do projeto</span>
      </header>
      <div className="eyebrow">Um lugar para assistir juntos</div>
      <h1>Sua tela. Seus amigos.</h1>
      <p>
        A base de uma experiência privada de compartilhamento. O player, as salas e o acesso por
        convite serão implementados nos próximos marcos.
      </p>
      <div className="layout">
        <section className="panel player" aria-label="Futuro player">
          <span className="screen" aria-hidden="true">
            ▣
          </span>
          <h2>O próximo momento começa aqui</h2>
          <p>
            Player ainda não implementado. Nenhuma conexão de mídia, câmera ou microfone é iniciada.
          </p>
          <span className="badge">Aguardando a prova de mídia · M1</span>
        </section>
        <aside className="panel">
          <h2>Conexão de controle</h2>
          <p
            role="status"
            aria-live="polite"
            className={`status ${connection.state === 'ready' ? 'ready' : 'error'}`}
          >
            {status}
          </p>
          <button type="button" className="secondary" onClick={retry}>
            Verificar novamente
          </button>
          <p className="notice">A conexão da API não comprova transporte de áudio e vídeo.</p>
        </aside>
      </div>
      <section className="panel mt-6">
        <h2>Oito opções para o futuro</h2>
        <p>Catálogo do produto. A capacidade deste computador ainda não foi detectada.</p>
        {connection.state === 'ready' ? (
          <div className="profile-grid">
            {connection.profiles.map((profile) => (
              <div className="profile" key={profile.id}>
                <strong>
                  {profile.height}p · {profile.fps} FPS
                </strong>
                <span>
                  {profile.width} × {profile.height}
                  {profile.height === 1440 ? ' · QHD' : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p>
            {connection.state === 'loading'
              ? 'Carregando catálogo…'
              : 'O catálogo ficará disponível quando a API estiver pronta.'}
          </p>
        )}
      </section>
      <footer>
        Ambiente local de desenvolvimento · Captura, autenticação e E2EE ainda não implementadas.
      </footer>
    </main>
  );
}
