# Bun Test nativo

Status: aceito após avaliação adicional solicitada pelo usuário · 26/10/2026. Substitui a escolha de Vitest nas ADRs 0006 e 0007; preserva organização, segurança e runtime Node de produção.

## Avaliação

Os 32 cenários unitários/DOM existentes passaram após adaptação às APIs nativas. Foram adicionados três testes da política LCOV. A comparação alternou três execuções em macOS arm64 com Bun 1.4.3, sem cobertura/DB/E2E nem limpeza de caches. Dados em `docs/benchmarks/bun-native-2026-10-26.json`.

| Fluxo                                           | Execuções (s)         | Mediana |
| ----------------------------------------------- | --------------------- | ------- |
| Vitest no Bun, 32 testes                        | 1,052 / 0,696 / 0,690 | 0,696s  |
| Bun Test nativo, 35 testes + build de contratos | 0,783 / 0,727 / 0,696 | 0,727s  |

O resultado ficou praticamente empatado; os fluxos não têm custo idêntico. Não se anuncia aceleração adicional. A vantagem considerada é unificar as ferramentas no runtime escolhido e remover Vitest/provedor, mantendo qualidade e cobertura.

## Decisão

Usar `bun:test` com mocks nativos, timers falsos e imports de módulos após registro dos mocks. Backend e DOM executam em processos separados; cada arquivo usa `--isolate`. Happy DOM é registrado por preload antes de React Testing Library. `bun run test` é o fluxo principal; testes DOM diretos exigem o preload.

Cobertura usa LCOV/text nativos, limiar 80% de linhas/funções, mais conferência explícita por arquivo com contadores exatos e inventário de fontes. São preservados sumário HTML com linhas não cobertas, JSON e LCOV agregado. Não se usam médias para compensar módulos abaixo do limite; contadores e relatórios inválidos falham. Os percentuais não são diretamente comparáveis ao V8/Vitest.

A suíte completa inclui PostgreSQL descartável e mede todo comportamento de runtime, mantendo as mesmas exclusões justificadas de wrappers/infraestrutura. Playwright permanece o runner E2E. Tipo não é validado por executar `.ts`, portanto os checks TypeScript continuam separados e incluem tipos Bun apenas em scripts/testes.

## Limites e validação

O runner nativo não fornece todas as APIs Vitest; os testes foram adaptados sem uma camada de compatibilidade. O limite por arquivo e o caminho negativo são verificados por regressões. CI remoto e shell Windows continuam pendentes; não há novas alegações de mídia, E2EE ou runtime Bun em produção.

Referências: [mocks](https://bun.sh/docs/test/mocks), [DOM](https://bun.sh/docs/test/dom), [isolamento](https://bun.sh/docs/test/parallel), [cobertura](https://bun.sh/docs/test/code-coverage).
