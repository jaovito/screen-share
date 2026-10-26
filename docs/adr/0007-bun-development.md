# Bun para desenvolvimento, workspaces e testes

Status: aceito após avaliação solicitada pelo usuário · 26/10/2026. Substitui as decisões de ferramenta pnpm/Node para desenvolvimento nas ADRs 0001 e 0006; preserva Node no runtime publicado da API.

**Atualização posterior:** a decisão de manter Vitest foi substituída pela ADR 0008 após nova solicitação e avaliação do usuário. Os dados abaixo registram a etapa anterior.

## Evidência local

Mesma suíte Vitest 5.0.5, 32 testes, três execuções alternadas no macOS arm64. Tempo total inclui startup; caches não foram limpos. Dados em `docs/benchmarks/bun-2026-10-26.json`.

| Executor     | Execuções (s)         | Mediana (s) |
| ------------ | --------------------- | ----------- |
| Node 24.22.1 | 3,344 / 1,800 / 1,977 | 1,977       |
| Bun 1.4.3    | 1,718 / 0,802 / 0,916 | 0,916       |

A amostra indica cerca de 54% menos tempo total, aproximadamente 2,16x neste cenário. Não comprova aceleração equivalente de Docker, Rust, Chromium, banco ou produção. Foi confirmado que os workers executam Bun, não apenas o comando pai.

## Decisão

Adotar Bun 1.4.3, já disponível e também usado no Truco, como gerenciador dos workspaces e runtime dos scripts/Vite/Vitest/Playwright. Gerar `bun.lock` pela ferramenta e usar instalação congelada. Desabilitar auto-install de imports; lifecycle scripts somente para dependências explicitamente confiáveis. Instalação não equivale a typecheck, que continua separado.

Manter Vitest, suas fixtures/isolamento e cobertura existente. A suíte completa com banco passou sob Bun (33 testes, 98,70% linhas e 96% funções); o inventário e os mínimos de 80% por arquivo permanecem. Uma meta temporária de 100% foi reprovada com código não zero, verificando o caminho negativo. Métricas de branches diferem entre executores e não são usadas para comparar performance ou relaxar política.

A API publicada continua Node LTS, Hono/adapter Node e pg. Desenvolvimento usa Bun por compatibilidade Node; E2E continua inicializando a API compilada com Node. A imagem usa Bun somente em instalação/build e Node sem privilégios no estágio final. Troca do servidor de produção exige decisão e validação próprias.

## Limites

Bun Native Test não é o runner escolhido: use `bun run test`; `bun test` não lê a configuração Vitest. Ferramentas são iniciadas explicitamente com `bun --bun` para não depender de shebang Node. O código do browser/domínio segue sem APIs Bun. A versão fixada é 1.4.3, a versão efetivamente medida; não se anuncia teste em versões posteriores.

Sucesso local não confirma CI remoto, shell Windows ou mídia. O gate Windows continua necessário. Node permanece instalado para o servidor de produção, E2E e ferramentas que o exigem.

## Referências

- [Workspaces Bun](https://bun.sh/docs/pm/workspaces)
- [Instalação Bun e trustedDependencies](https://bun.sh/docs/pm/cli/install)
- [Compatibilidade Node](https://bun.sh/docs/runtime/nodejs-compat)
- [Vitest e ambientes de teste](https://vitest.dev/guide/)
