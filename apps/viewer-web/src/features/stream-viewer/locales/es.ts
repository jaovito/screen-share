export default {
  documentTitle: 'Screen Share — Espectador',
  badge: 'M0 · Base del proyecto',
  eyebrow: 'Un lugar para ver juntos',
  heading: 'Tu pantalla. Tus amigos.',
  intro:
    'La base de una experiencia privada para compartir. El reproductor, las salas y el acceso por invitación se implementarán en los próximos hitos.',
  playerLabel: 'Futuro reproductor',
  playerHeading: 'El próximo momento empieza aquí',
  playerUnavailable:
    'El reproductor aún no está implementado. No se inicia ninguna conexión de medios, cámara o micrófono.',
  mediaPending: 'Esperando la prueba de medios · M1',
  connectionHeading: 'Conexión de control',
  apiLoading: 'Conectando con la API…',
  apiReady: 'API conectada · base de datos lista',
  apiUnavailable: 'API o base de datos no disponible',
  apiError: 'Respuesta de la API incompatible',
  retry: 'Volver a comprobar',
  controlNotice: 'La conexión con la API no demuestra el transporte de audio y vídeo.',
  catalogHeading: 'Ocho opciones para el futuro',
  catalogNotice: 'Catálogo del producto. Aún no se ha detectado la capacidad de este equipo.',
  catalogLoading: 'Cargando catálogo…',
  catalogUnavailable: 'El catálogo estará disponible cuando la API esté lista.',
  profileLabel: '{{height}}p · {{fps}} FPS',
  footer:
    'La captura nativa y la autenticación del producto siguen sin estar disponibles. El receptor M1 es experimental.',
  proofHeading: 'M1 · Receptor cifrado experimental',
  proofNotice:
    'Prueba técnica voluntaria. Solicita al operador de confianza una autorización de espectador con vencimiento y recibe la clave por otro canal cifrado. Las credenciales permanecen en memoria y se borran del formulario al conectar. Esto no verifica el emisor Windows, el cifrado de extremo a extremo ni la preparación para producción.',
  proofGrant: 'Autorización de espectador JSON',
  proofKey: 'Clave de medios independiente',
  proofConsent:
    'Confío en el operador y este servidor, y quiero conectarme explícitamente a la sesión de prueba seleccionada.',
  proofConnect: 'Conectar a la prueba',
  proofDisconnect: 'Desconectar',
  proofVideo: 'Vídeo experimental de pantalla compartida',
  proofState_idle: 'Desconectado. No se inicia ninguna conexión de medios automáticamente.',
  proofState_connecting: 'Configurando el cifrado y conectando…',
  proofState_waiting: 'Conectado. Esperando el vídeo cifrado de pantalla del emisor designado.',
  proofState_subscribed:
    'Suscrito al vídeo cifrado. La reproducción no verifica el hardware ni la privacidad.',
  proofState_invalidGrant:
    'Autorización inválida. Usa una autorización vigente de espectador emitida por el operador.',
  proofState_invalidKey: 'Clave de medios inválida. Usa la clave independiente de 43 caracteres.',
  proofState_unsupported:
    'La recepción cifrada requiere un contexto seguro y un navegador con transformaciones de vídeo codificado compatibles.',
  proofState_expired: 'La autorización venció o supera la ventana de cinco minutos. Solicita otra.',
  proofState_failed:
    'Recepción detenida. No se pudieron mantener los requisitos de conexión, emisor, pista o cifrado. Vuelve a conectar explícitamente con una autorización y clave válidas.',
};
