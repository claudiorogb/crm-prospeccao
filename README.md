# CRM Prospecção V30

**V30:** envio da fila movido para o backend. O navegador não precisa permanecer aberto para as mensagens agendadas serem processadas.


## v27 — Clientes, histórico e compras

- Leads com status `won` aparecem automaticamente em **Clientes**.
- A ficha do cliente reaproveita o cadastro do lead e adiciona razão social, CNPJ, cargo do contato, WhatsApp e origem comercial.
- Interações manuais são registradas em `activities` (WhatsApp, ligação, e-mail, reunião e observação).
- Cada venda é um registro independente em `sales`; novos registros nunca sobrescrevem compras anteriores.
- A ficha calcula número de compras, total comprado, ticket médio e última compra a partir do histórico.
- `next_contact_date` é usado como próxima ação do cliente.

# CRM Prospecção V1

Primeira interface do projeto.

## O que já faz

- Cadastro por e-mail e senha usando Supabase Auth
- Login
- Criação da primeira organização
- Criação do vínculo do usuário como owner
- Configuração inicial:
  - cidade
  - estado
  - raio
  - 20 contatos/dia
  - segunda/quarta/sexta
  - cota Google Places de 4.500/mês
- Dashboard inicial
- Logout

## Como rodar no computador

1. Instale Node.js LTS.
2. Abra a pasta do projeto no terminal.
3. Copie `.env.example` para `.env`.
4. Execute:

   npm install
   npm run dev

5. Abra o endereço informado pelo Vite no navegador.

## Segurança

O frontend usa apenas a chave publishable do Supabase.
Nunca coloque service_role ou secret key no frontend.

## Próximas etapas

- Campanhas
- Cadastro e listagem de leads
- Score
- Modelos de mensagem
- Google Places
- Fila de prospecção


## V2

- Tela de Campanhas
- Criação de campanha
- Listagem de campanhas
- Segmento, região, raio, score mínimo e limite diário

## V3

- Correção do cabeçalho nas telas
- E-mail do usuário e botão de ação separados no topo
- Layout mais estável em diferentes larguras de tela

## V4

- Tela de Leads
- Cadastro manual de empresas
- Associação opcional a campanha
- Segmento, telefone, e-mail, site, endereço, cidade, estado e score
- Filtros por busca, segmento e status
- Alteração de status diretamente na lista
- Dashboard com contadores reais baseados nos leads

## V5

- Leads preparados para fluxo automatizado
- Ação "Descartar": mantém o registro e evita reentrada quando a captação usar google_place_id
- Ação "Excluir": remove definitivamente, com confirmação
- Aviso de que leads excluídos podem ser reencontrados em captações futuras

## V6

- Removido botão redundante "Descartar"
- O status "Descartado" continua no seletor de status
- "Excluir definitivamente" virou ação secundária e discreta

## V7

- Tela Captação conectada à Edge Function `capture_places_leads`
- Busca automática por campanha
- Inserção automática apenas de leads que atingem o score mínimo
- Deduplicação pelo Google Place ID
- Contadores de encontrados, inseridos, duplicados e abaixo do score
- Exibição do consumo mensal da API
- Limite interno ajustado para 900 eventos/mês por usar campos Enterprise (telefone/site/rating/reviews)

## V8

- Captação com raio geográfico real
- Centro da cidade resolvido e armazenado na campanha
- Resultados fora do raio são descartados automaticamente
- Score revisado e mais discriminante
- Contador de resultados fora do raio
- Separação visual do consumo Enterprise e Pro

## V9

- Site exibido na lista de leads
- Removida a coluna visual de origem
- Link para abrir o site em nova aba
- Nova página "Pontuação"
- Explicação das faixas e critérios de score
- Aviso de que a metodologia ainda será calibrada com dados reais de conversão

## V10

- Cidade permanece como campo livre
- UF agora usa lista suspensa com todas as 27 UFs
- Aplicado em onboarding, campanhas e cadastro manual de leads
- Estrutura mais adequada para uso comercial nacional

## V11
- Página Mensagens
- Modelos por segmento
- Preparar e copiar mensagem por lead

## V12

- Removida a página Pontuação
- Score deixou de ser critério de entrada de leads
- Nova página Públicos-alvo
- Públicos-alvo personalizados por organização
- Termos de busca editáveis, um por linha
- Campanhas vinculadas a públicos-alvo dinâmicos
- Captação usa termos do público em rotação, uma chamada por execução
- Mensagens vinculadas a públicos-alvo personalizados
- Leads deixam de exibir score
- Critérios objetivos: público, raio, empresa operacional e duplicidade

## V13

- Checkboxes na lateral esquerda dos leads
- Selecionar todos os leads filtrados
- Preparação de mensagens em massa
- Validação de telefone e modelo ativo antes do lote
- Banco com outbound_batches e outbound_messages
- Nova página Envios
- Revisão do lote antes do envio
- Abertura manual no WhatsApp com mensagem preenchida
- Estrutura pronta para futura integração oficial de envio automático
- Nenhuma lógica de temporização para evasão de detecção

## V15

- Catálogo CRM global no Supabase
- Catálogo editável apenas pelo administrador do sistema
- Clientes podem consultar segmentos e termos sugeridos
- Novo público pode partir de um segmento do catálogo
- Termos recomendados aparecem pré-selecionados
- Outros termos sugeridos são clicáveis
- Cliente pode adicionar termos personalizados
- Público-alvo continua totalmente personalizável
- Novos públicos aparecem automaticamente em Campanhas

## V16

- Campo Segmento / público-alvo agora é digitável e pesquisável
- Sugestões do catálogo aparecem enquanto o usuário digita
- Segmentos fora do catálogo continuam permitidos
- Termos sugeridos carregam quando há correspondência com o catálogo
- Corrigida renderização da página Catálogo CRM


## V17 — Administração estrutural

- Um único menu principal "Administração"
- Submenu interno: Visão geral, WhatsApp, Fila, Catálogo CRM, Clientes, Google Places, Padrões, Mensagens e Auditoria
- Cadastro, ativação, definição de padrão e exclusão de números WhatsApp
- Intervalo padrão de 120s e limite de 20 por lote configuráveis pelo administrador
- Pausa geral dos envios e contador de enviados no dia
- Fila com horários programados, remetente, cancelamento, pausa/retomada e repetição de falhas
- Clientes: criar, renomear, ativar/desativar, vincular/suspender/remover usuários e definir papel
- Google Places: limites, consumo e teste de conexão
- Configurações padrão e feature flags por organização
- Modelos de mensagens administráveis por cliente
- Auditoria estrutural de alterações
- Botão "Enviar mensagem" agora usa a Edge Function de enfileiramento do servidor
- Provedor de envio real ainda não definido nem acoplado


## V18 — Evolution API

- Administração > WhatsApp cria automaticamente uma instância Evolution API usando Baileys.
- O QR Code é exibido dentro do próprio CRM.
- O CRM consulta o estado da conexão e registra `connected` no Supabase.
- A API key da Evolution não é enviada ao bundle React durante desenvolvimento: o Vite faz proxy local em `/evolution`.
- Para desenvolvimento local, adicione ao `.env`:
  - `EVOLUTION_API_URL=http://localhost:8080`
  - `EVOLUTION_API_KEY=CRM_Evolution_2026_Teste`
- Em produção, o proxy será substituído pela camada backend quando a Evolution estiver hospedada.

## V19

- Consumidor local da fila de WhatsApp no frontend durante a fase de testes
- Mensagens vencidas em `queued/ready` são enviadas automaticamente pela Evolution API local
- Atualização automática para `sent` ou `failed`
- Lead passa para `contacted` após envio bem-sucedido
- Contadores/status dos lotes são atualizados
- Campo de telefone do lead com `+55` fixo
- O usuário digita apenas DDD + número; o banco continua salvando com 55

## V20

- Corrige o consumidor da fila: `QueueWorker` agora é efetivamente renderizado dentro do `App`.
- Mensagens `queued/ready` vencidas passam a ser processadas automaticamente pela Evolution API local.

## V21

- Corrige tela branca da V20.
- O `QueueWorker` usa `React.useRef` e `React.useEffect`; a V20 não importava o objeto `React`.
- Mantém o consumidor local da fila e o campo de telefone com +55 fixo.

## V22

- Atualização em tempo real do status dos leads.
- Leads refletem automaticamente mudanças como `queued` -> `contacted`.
- Fila administrativa atualiza lotes e mensagens em tempo real.
- Supabase Realtime habilitado para `leads`, `outbound_messages` e `outbound_batches`.

## V23

- Corrige sincronização visual dos status dos leads.
- Remove listener Realtime que havia sido inserido no componente errado na V22.
- Leads consultam apenas `id/status` a cada 3 segundos e atualizam a tela automaticamente.
- Tela de Fila também é atualizada automaticamente a cada 3 segundos.
- Atualização adicional ao retornar o foco para a janela do CRM.

## V24

- Leads agora possuem `Nome do contato`.
- `Último contato` em formato de data, editável manualmente.
- `Próximo contato previsto` em formato de data.
- Envio de WhatsApp bem-sucedido atualiza automaticamente `Último contato`.
- Nova página `WhatsApp` no menu normal do CRM.
- Qualquer usuário ativo da organização pode adicionar, conectar, definir padrão, ativar/desativar e excluir números da própria organização.
- `Administração > WhatsApp` continua disponível para o administrador do sistema com visão global e regras de envio.

## V25

- Corrige o campo `Nome do contato`.
- O polling automático não sobrescreve mais `contact_name` enquanto o usuário digita.
- A atualização automática continua para `status` e `last_contact_date`.
- `next_contact_date` e `contact_name` permanecem sob controle direto do usuário.

## V26

- `Último contato` continua automático após envio de WhatsApp e também é editável manualmente.
- Alterações manuais de `Último contato` são gravadas imediatamente.
- `Próximo contato previsto` é gravado imediatamente.
- Quando `Próximo contato previsto` estiver em data anterior ao dia atual, o campo fica vermelho e exibe `Atrasado`.
- A data atual não é tratada como vencida.

## V29 — Usuários e separação da administração

- O login original de testes deixa de pertencer à Deloc e passa a ser somente administrador da plataforma.
- `administrativosp@deloc.com.br` passa a ser proprietário da organização existente `Deloc Campinas`.
- Nenhum dado da Deloc é recriado ou perdido; o vínculo é transferido para a conta correta.
- Administrador da plataforma pode funcionar sem pertencer a nenhuma organização.
- Cabeçalho do administrador mostra `Administração`, e não `Deloc Campinas`.
- Novos cadastros não criam organização automaticamente.
- Usuário confirmado e ainda sem empresa vê apenas `Conta aguardando liberação`.
- Contas `inativas` ou `suspensas` têm o acesso bloqueado.
- Nova área `Administração > Usuários` lista todos os usuários.
- O administrador pode definir:
  - Usuário comum ou Administrador da plataforma
  - Organização vinculada
  - Papel dentro da organização
  - Ativo, Inativo ou Suspenso
  - Exclusão definitiva do usuário
- Administradores da plataforma não podem ficar simultaneamente vinculados a uma empresa.
- Criação de novas organizações pelo banco ficou restrita ao administrador da plataforma.


## V29 - Evolution no backend
- Chamadas da Evolution API passam pela Supabase Edge Function `evolution_gateway`.
- A chave da Evolution não fica mais no frontend/Vite.
- O QueueWorker solicita o envio ao backend; o backend valida organização, mensagem, número e atualiza o CRM.
- É necessário configurar o secret `EVOLUTION_API_KEY` no Supabase antes de testar o WhatsApp hospedado.
