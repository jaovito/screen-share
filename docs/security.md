# Segurança e privacidade

M0 é local, sem autorização de produto ou mídia. API e banco ficam restritos ao host; o CORS permite somente os dois endereços locais do viewer. CORS não substitui autenticação. Não exponha esta configuração à internet ou à LAN.

O bootstrap gera senha de banco (32 bytes), chave LiveKit (18 bytes) e segredo LiveKit (48 bytes) com `node:crypto`. Cria arquivos com exclusividade e modo 0600 onde suportado, preservando arquivos existentes. No Windows, controle acesso pela ACL do diretório. `.env` e configuração LiveKit efetiva são ignorados pelo Git e pelo contexto Docker; nunca fazem parte da imagem. O template é preenchido com strings YAML escapadas; LiveKit não precisa expandir variáveis.

Segredos ficam apenas no backend e configuração local. Não introduza segredos em `VITE_*`, DTOs IPC, URLs públicas, logs ou bundles. `DATABASE_URL` é configuração interna do driver e contém credenciais; não imprima seu valor. A imagem recebe variáveis somente na execução, sem build args secretos. O runtime usa usuário `node` sem privilégios. O smoke usa o SDK administrativo somente no backend para `listRooms`, com timeout e sem mostrar conteúdo.

O shell possui uma única permissão de aplicativo para `get_app_info`, sem plugins de shell, filesystem ou HTTP e sem comandos de captura disponíveis. CSP restringe scripts ao conteúdo local, IPC e Vite/HMR em desenvolvimento. Não há navegação remota, auto-captura ou leitura de microfone/câmera.

Readiness falha fechada em banco/schema indisponíveis e retorna somente status. A API não expõe mutations de salas, login falso, token arbitrário ou confiança em uma identidade fornecida pelo cliente. Preservar esses limites ao evoluir o bootstrap.

Antes da beta: autenticação, autorização por membership, convites limitados, grants mínimos e escopados, TLS, gestão de chaves fora do banco, identidade verificável dos participantes, epochs e revogação de sessão, E2EE validada em dois PCs e política de auditoria/retencão. O plano de ameaça e a prova de encoder/transporte constam em PLAN.md; nenhum selo de E2EE deve aparecer sem evidência.

Não trocar uma janela por monitor inteiro como recuperação de falha. Não captar áudio do sistema como fallback implícito. Métricas precisam vir dos estágios reais; presets e hipóteses não são medições.
