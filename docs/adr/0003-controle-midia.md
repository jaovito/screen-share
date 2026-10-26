# Controle separado de mídia

Status: aceito para M0 · 26/10/2026.

## Contexto

Autorização não deve transportar frames, nem HTTP saudável provar RTC.

## Decisão

Hono/PostgreSQL para controle, LiveKit para SFU. Transmissor Windows nativo, viewer web. Uma camada de publicação é hipótese de beta a provar.

## Consequências

M0 não publica áudio/vídeo, tokens de sala ou criptografia. TURN e revogação precisam de desenho e testes próprios.
