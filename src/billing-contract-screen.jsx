import React, { useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, Loader2, FileText } from 'lucide-react'
import { supabase } from './lib/supabase'

export const AXIVA_PAID_CONTRACT_VERSION = '2026-10-05-v2'

const CONTRACT_TEXT = "CONTRATO DE USO\n\nPartes\n\nO AXIVA CRM, da marca AXIVA, é oferecido por Claudio Rogério Borges, pessoa física, a partir de agora identificado por CONTRATADA e o presente contrato é celebrado com a empresa identificada pelo CNPJ cadastrado no CRM, representada pelo responsável que realiza a contratação a partir de agora identificado por CONTRATANTE.\n\n1. DO OBJETO\n\n1.1. O presente contrato tem por objeto a concessão de licença de uso temporária, não exclusiva, intransferível e onerosa do software de gestão de relacionamento com clientes (Customer Relationship Management – CRM) denominado AXIVA CRM, disponibilizado na modalidade SaaS (Software as a Service), bem como a prestação dos serviços de suporte técnico e manutenção correlatos.\n\n1.2. A CONTRATADA concede à CONTRATANTE, pelo prazo contratual, direito limitado, não exclusivo e intransferível de acesso remoto ao AXIVA CRM, para gestão de suas próprias atividades comerciais, de acordo com o plano, os limites, os usuários autorizados e as funcionalidades efetivamente habilitadas na data de ativação.\n\n1.3. A contratação não transfere a propriedade do software, do código-fonte, da marca ou da infraestrutura. Não inclui serviços de consultoria, promessa de captação de clientes, vendas, conversão ou resultado financeiro.\n\n1.4. Funcionalidade anunciada, planejada, em desenvolvimento ou dependente de homologação de terceiro somente integra a obrigação de entrega quando estiver marcada como “habilitada” no Anexo I ou for incluída por aditivo aceito pelas partes\n\n2. DA CONTRATAÇÃO E LICENCIAMENTO\n\n2.1. A CONTRATANTE adquire, neste ato, o acesso para uso do AXIVA CRM conforme as especificações e quantidades a seguir descritas:\n\n- Plano contratado: AXIVA / AXIVA Plus / AXIVA Max\n- Quantidade de acessos: 1 (um) acesso de usuário ativo.\n\n2.2. As credenciais de acesso são de uso pessoal, individual e intransferível, sendo vedado o compartilhamento do mesmo usuário por múltiplos operadores simultâneos ou alternados.\n\n3. DA VIGÊNCIA\n\n3.1. O contrato terá vigência de 12 (doze) meses a contar da data da ativação, compreendendo um período inicial de teste gratuito de 30 (trinta) dias corridos para o plano AXIVA.\n\n3.2. A CONTRATANTE poderá solicitar o cancelamento sem qualquer ônus ou penalidade a qualquer momento dentro dos 30 (trinta) dias gratuitos iniciais.\n\n3.3. Durante esses 30 dias não incidirá mensalidade, taxa de ativação, cobrança proporcional, multa ou obrigação de compra.\n\n3.4. Decorrido o período gratuito sem solicitação de cancelamento, o contrato será mantido até o término dos 12 (doze) meses e renovado automaticamente por períodos sucessivos de 12 (doze) meses. Não será cobrado nenhum tipo de multa ou compensação financeira pela rescisão do contrato a qualquer tempo.\n\n3.5. O pedido de cancelamento poderá ser encaminhado pelo canal de atendimento disponibilizado pela CONTRATADA, podendo ser por e-mail, telefone ou mensagem de Whatsapp ou pela própria ferramenta de cancelamento, se disponível no momento do cancelamento. O recebimento será confirmado, e a data/hora do pedido ficará registrada. A indisponibilidade de um canal não impedirá o uso de outro canal oficial divulgado.\n\n4. DO PREÇO\n\n4.1. Pela prestação dos serviços, a CONTRATANTE pagará à CONTRATADA o valor mensal estipulado conforme o plano contratado: AXIVA / AXIVA Plus / AXIVA Max por usuário ativo cadastrado na plataforma.\n\n5. DO PAGAMENTO\n\n5.1. O pagamento poderá ser realizado diretamente à CONTRATADA por cartão, PIX ou depósito na conta bancária formalmente informada pela CONTRATADA, ou por meio de plataforma de pagamento devidamente identificada e informada pela CONTRATADA.\n\n5.2. A cobrança terá início a partir do 31º dia de uso no plano AXIVA.\n\n6. DA ADIÇÃO E GESTÃO DE USUÁRIOS\n\n6.1. A CONTRATANTE poderá contratar licenças adicionais para novos usuários a qualquer momento mediante pagamento de licenças adicionais.\n\n6.3. A adição de usuários deverá ser efetuada diretamente pelo administrador da CONTRATANTE mediante solicitação formal ao e-mail de suporte da CONTRATADA.\n\n7. DAS FUNCIONALIDADES E CONTROLES DO CRM\n\n7.1. Conforme o plano contratado e o inventário do Anexo I, o sistema poderá oferecer: (a) cadastro, pesquisa, importação, deduplicação, captação e gestão de leads; (b) organização por etapas de funil/Kanban, valores em negociação, tarefas e próximos contatos; (c) cadastro de clientes, histórico de interações, vendas independentes, indicadores comerciais e acompanhamento de oportunidades; (d) campanhas e mensagens por canais de comunicação integrados e autorizados, filas, estados de envio e respectivos registros; (e) filtros por segmento, localidade e termos de busca, quando habilitada a integração de descoberta; (f) perfis de acesso, administração de usuários, configurações da empresa e recursos de importação/exportação disponíveis.\n\n7.2. Cada registro de venda lançado pela CONTRATANTE deverá permanecer individualizado, sem substituir os registros anteriores.\n\n7.3. Captar leads por ferramentas de descoberta ou importar resultados de pesquisa é atribuição exclusiva dos administradores da empresa, quando tal módulo estiver habilitado. Usuários comuns poderão utilizar apenas as operações liberadas pelo perfil atribuído. Administradores da CONTRATANTE são responsáveis por definir e informar à CONTRATADA quais usuários tem acesso de “usuário comum” e “usuário administrador”.\n\n7.4. Integrações com Google, Gmail, WhatsApp, plataformas de cobrança, ERPs e outras ferramentas externas dependem de disponibilidade, autorização, credenciais, regras e eventuais custos de implantação e de seus respectivos provedores.\n\n8. DA SUSPENSÃO DOS SERVIÇOS E SEGURANÇA DA INFORMAÇÃO\n\n8.1. O descumprimento das obrigações de pagamento ensejará a notificação da CONTRATANTE para regularização no prazo de até 5 (cinco) dias corridos.\n\n8.2. Não sanada a inadimplência no prazo fixado, o acesso dos usuários da CONTRATANTE à plataforma será temporariamente bloqueado. A suspensão persistirá até a liquidação integral dos valores pendentes acrescidos dos encargos moratórios.\n\n8.3. Durante o período de suspensão por inadimplência, e até a eventual rescisão do contrato, a CONTRATADA assegurará à CONTRATANTE meio seguro para a exportação de seus dados operacionais, mediante solicitação formal.\n\n8.4. A manutenção da suspensão por período superior a 30 (trinta) dias ensejará a rescisão de pleno direito do contrato, facultando à CONTRATADA a cobrança das penalidades contratuais e a eliminação definitiva da base de dados do cliente na plataforma, conforme previsto na cláusula 17, observados os prazos legais de retenção da LGPD.\n\n8.5. A CONTRATADA reserva-se o direito de suspender imediatamente o acesso à plataforma diante de evidências de fraude, violação de direitos de terceiros, ataques cibernéticos ou comprometimento das credenciais de acesso, visando resguardar a integridade dos sistemas. A CONTRATANTE será notificada no menor tempo possível, restabelecendo-se os acessos assim que sanada a vulnerabilidade.\n\n9. DAS MULTAS - INADIMPLEMENTO E CANCELAMENTO ANTECIPADO\n\n9.1. O atraso no pagamento de qualquer obrigação financeira implicará:\n\na) Incidência automática de multa de 2% (dois por cento) sobre o valor em atraso;\nb) Juros de mora de 1% (um por cento) ao mês, aplicados diariamente desde o vencimento até o pagamento, e;\nc) O atraso superior a 5 (cinco) dias ensejará a suspensão temporária do acesso à plataforma, sem que isso isente a CONTRATANTE dos valores devidos e dos acréscimos legais.\n\n9.2. O contrato poderá ser rescindido pela CONTRATANTE a qualquer tempo, mediante aviso prévio e por escrito com antecedência mínima de 30 (trinta) dias. Ocorrendo a solicitação de cancelamento, a CONTRATANTE deverá quitar eventuais débitos pendentes.\n\n9.3 Não se aplicarão multas, aviso prévio ou qualquer outra cobrança se o cancelamento se der durante o período de testes de 30 (trinta) dias gratuitos no plano AXIVA.\n\n10. DO REAJUSTE DE PREÇOS\n\n10.1. Os valores das mensalidades estipulados neste contrato serão reajustados automaticamente a cada período de 12 (doze) meses contados da data de início da vigência deste contrato, com base na variação positiva acumulada do IPCA/IBGE (Índice Nacional de Preços ao Consumidor Amplo).\n\n10.2. Caso o IPCA apresente variação acumulada negativa (deflação) no período de apuração, o valor da mensalidade permanecerá inalterado, não havendo redução de preço.\n\n10.3. Na hipótese de extinção do IPCA, utilizar-se-á sucessivamente o IGP-M/FGV ou outro índice oficial que venha a substituí-lo.\n\n11. USO LÍCITO, PROSPECÇÃO E COMUNICAÇÕES\n\n11.1. A CONTRATANTE é responsável pela origem, finalidade, atualização, base legal e conteúdo dos dados de leads e clientes que cadastrar, pesquisar ou importar, bem como pelo respeito à LGPD, aos direitos de terceiros e às regras aplicáveis de comunicação comercial.\n\n11.2. O envio de e-mails, mensagens de WhatsApp ou campanhas deve observar os requisitos de consentimento ou outra base legal adequada e as políticas efetivamente aplicáveis a cada serviço. Quando um canal exigir autorização prévia específica do destinatário, a CONTRATANTE deverá obtê-la e conservar evidências. Autodeclaração em campo do CRM não substitui essa comprovação nem autoriza prospecção vedada pelo provedor.\n\n11.3. São proibidos fraude, invasão, discriminação ilícita, captação ou tratamento sem base legal, mensagens ilegais ou abusivas, compartilhamento de credenciais, evasão de limites de envio e tentativa de burlar controles de segurança. A CONTRATADA poderá bloquear operação abusiva com medida proporcional, registrar o motivo e comunicar a CONTRATANTE quando a urgência permitir.\n\n11.4. Informações provenientes de cadastros e serviços externos podem estar desatualizadas ou incompletas. A CONTRATANTE deve conferir a pertinência dos dados antes do uso comercial; a CONTRATADA responde pelas obrigações que efetivamente lhe competem, sem garantir a exatidão integral da fonte de terceiros.\n\n12. DA RESPONSABILIDADE PELO USO DOS CANAIS DE COMUNICAÇÃO (WHATSAPP E E-MAIL)\n\n12.1. A CONTRATANTE declara ciência de que a funcionalidade de envio de mensagens via WhatsApp integrada à plataforma não utiliza a API oficial da Meta (WhatsApp Business API). O envio massivo ou direcionado a contatos sem consentimento prévio (leads frios) pode ensejar o bloqueio temporário ou definitivo do número de telefone cadastrado pela CONTRATANTE, sem qualquer responsabilidade da CONTRATADA.\n\n12.2. O uso do módulo de e-mail marketing deve observar estritamente as políticas dos provedores de e-mail (incluindo as diretrizes do Google). O envio de mensagens não solicitadas a bases frias ou sem opt-in prévio pode acarretar o bloqueio da conta de e-mail ou do domínio cadastrado pela CONTRATANTE.\n\n12.3. A CONTRATANTE compromete-se a sinalizar na plataforma apenas os contatos devidamente autorizados a receber comunicações. A CONTRATANTE reconhece que a plataforma disponibiliza parâmetros técnicos de envio, mas não possui meios de verificar a veracidade da autorização declarada. O descumprimento das regras de envio e políticas anti-spam sujeitará o e-mail cadastrado a sanções e bloqueios diretamente exercidos pelos provedores de e-mail.\n\n12.4. A CONTRATADA exime-se de qualquer responsabilidade por bloqueios, restrições ou banimentos temporários ou definitivos ocorridos nas contas de WhatsApp, e-mails ou domínios da CONTRATANTE decorrentes do uso inadequado, envio de spams ou descumprimento das regras dos provedores por parte da CONTRATANTE.\n\n13. CONTAS, PERFIS E ISOLAMENTO ENTRE EMPRESAS\n\n13.1. Cada usuário utilizará credenciais individuais. A CONTRATANTE deverá administrar desligamentos, permissões e medidas de autenticação disponíveis, comunicar acessos suspeitos e evitar o compartilhamento de senhas.\n\n13.2. A CONTRATADA deverá manter controles técnicos e organizacionais compatíveis com o serviço para restringir acesso indevido e separar logicamente os dados de empresas distintas. Acesso administrativo técnico para suporte será limitado à finalidade necessária e sujeito a registro e confidencialidade.\n\n13.3. Acesso a informações de outra empresa sem autorização constitui incidente de severidade crítica e exigirá investigação e contenção imediatas, além das providências legais cabíveis.\n\n14. PROTEÇÃO DE DADOS E CONFIDENCIALIDADE\n\n14.1. Em regra, a CONTRATANTE decide finalidades e meios essenciais do tratamento dos dados pessoais de seus leads e clientes, atuando como controladora. A CONTRATADA atua como operadora na execução das instruções lícitas recebidas. O tratamento de dados próprios da CONTRATADA para cobrança, segurança e cumprimento de obrigações legais poderá envolver atuação autônoma como controladora, conforme documentação de privacidade.\n\n14.2. A CONTRATADA não utilizará dados comerciais da CONTRATANTE para prospectar em benefício próprio ou de outra empresa sem fundamento jurídico e autorização cabíveis.\n\n14.3. Ambas as partes preservarão sigilo de dados comerciais, credenciais, informações técnicas, vulnerabilidades e informações não públicas, inclusive após o término contratual, ressalvados deveres legais e informações comprovadamente públicas.\n\n15. DISPONIBILIDADE E MANUTENÇÃO\n\n15.1. A CONTRATADA compromete-se a limitar a indisponibilidade NÃO PROGRAMADA do núcleo do CRM a, no máximo, 8 (oito) horas acumuladas por mês, inclusive durante o teste gratuito. A interrupção que atravessar a virada do mês será atribuída a cada mês conforme sua duração efetiva.\n\n15.2. Considera-se indisponibilidade a impossibilidade de acessar ou executar a função principal do serviço contratado, causada por falha do ambiente de produção, inclusive dependência de infraestrutura de terceiros que impeça o funcionamento do núcleo do CRM. Não entram na apuração falhas exclusivamente na conexão, dispositivo ou rede da CONTRATANTE, nem indisponibilidade isolada de integração externa que não impeça o funcionamento do núcleo, sem prejuízo do suporte previsto no SLA.\n\n15.3. Manutenção programada somente será excluída da contagem quando comunicada previamente à CONTRATANTE com antecedência mínima de 48 horas, com indicação de janela, impacto e canal de acompanhamento. A manutenção de emergência necessária à segurança será comunicada tão logo viável, com registro de sua justificativa, e não poderá ser rotulada retroativamente como programada para afastar o SLA.\n\n15.4. A CONTRATADA manterá registro das ocorrências, início e término, causa provável, medidas adotadas e tempo total mensal. Se o limite de 8 horas for ultrapassado, comunicará o descumprimento, apresentará plano de correção e tratará eventual reparação conforme a lei e as circunstâncias do caso. Esta minuta não fixa crédito financeiro automático ou teto de indenização.\n\n16. SUPORTE TÉCNICO E CRITÉRIOS DE PRAZO\n\nCANAL DE SUPORTE / HORÁRIO DE ATENDIMENTO: Whatsapp 11 94167-6919 | e-mail axivainvest@gmail.com, de segunda à sexta das 8h às 18h aos sábados das 8h às 13h\n\nCANAL PARA CANCELAMENTO: Whatsapp 11 94167-6919 | e-mail axivainvest@gmail.com.\n\n16.1. Os níveis de serviço do Anexo II aplicam-se a solicitações recebidas em canal oficial disponibilizado pela CONTRATADA, respeitando os dias e horários apontados na cláusula anterior. A plataforma poderá ser monitorada 24 horas por dia, mas isso não equivale a plantão de suporte ininterrupto. O atendimento fora desse horário só será prometido se houver escala 24 × 7 confirmada expressamente no Anexo II.\n\n16.2. A contagem da primeira resposta começa com o registro da solicitação no canal oficial, acompanhado de descrição e elementos mínimos para identificar o problema; informações complementares não poderão ser exigidas de forma abusiva para reiniciar o relógio. Salvo plantão 24 × 7 expressamente contratado, os prazos são contados apenas dentro do horário de atendimento informado no Anexo II.\n\n16.3. “Primeira resposta” é contato humano ou técnico individualizado que reconheça o chamado e indique seu encaminhamento; confirmação automática de recebimento, isoladamente, não constitui primeira resposta. “Contorno” é medida operacional que restabeleça o uso essencial sem comprometer dados ou segurança; a correção definitiva poderá demandar trabalho adicional informado à CONTRATANTE.\n\n16.4. Prazos de solução são metas contratuais de atendimento e correção/contorno no escopo controlado pela CONTRATADA. Em incidente cuja resolução técnica dependa de cooperação essencial da CONTRATANTE ou de ação de provedor externo, a CONTRATADA deverá documentar a dependência, adotar contornos disponíveis e manter comunicação.\n\n17. BACKUP, RESTAURAÇÃO, EXPORTAÇÃO E DESTINAÇÃO DOS DADOS\n\n17.1. A CONTRATANTE poderá exportar os dados de sua empresa armazenados no AXIVA CRM, incluindo cadastros de leads e clientes, histórico de contatos, próximos contatos agendados e registros de vendas.\n\n17.2. A exportação será disponibilizada em formato Excel (.xlsx), contendo planilhas separadas por categoria de informação.\n\n17.3. Durante a vigência do contrato, a exportação poderá ser realizada diretamente na plataforma por usuário autorizado, sem custo adicional.\n\n17.4. Caso solicite a exportação à CONTRATADA, os dados serão disponibilizados em até 5 (cinco) dias úteis, contados do recebimento da solicitação e da confirmação da identidade e autorização do solicitante.\n\n17.5. A disponibilização dos dados observará as medidas de segurança e proteção das informações da CONTRATANTE.\n\n17.6. A CONTRATANTE poderá solicitar a exportação de seus dados operacionais em formato compatível com Excel (.xlsx ou .csv) no prazo de até 30 (trinta) dias contados da data de encerramento do contrato. Após o recebimento do pedido formal, pelo representante legal da CONTRATANTE, a CONTRATADA terá o prazo de até 5 (cinco) dias úteis para efetuar a entrega do arquivo de dados.\n\n17.7. Decorrido o prazo de 30 (trinta) dias sem manifestação da CONTRATANTE, a CONTRATADA poderá promover a eliminação ou anonimização definitiva dos dados da plataforma, ressalvadas as hipóteses de guarda obrigatória previstas em lei ou na LGPD. Não se garante recuperação após a eliminação regularmente concluída.\n17.8. Informação sobre backup e restauração (situação em 20/09/2026): há cópias sanitizadas diárias de dados e uma cópia cifrada pontual dos esquemas selecionados do banco. Foi demonstrada a restauração do banco principal em ambiente separado; a recuperação completa do aplicativo, dos anexos físicos e das integrações ainda não foi validada. Prazo de retenção dos backups, RPO e RTO da recuperação integral não foram definidos ou medidos. Esta informação não modifica os prazos e as obrigações previstos nas demais cláusulas.\n\n18. INCIDENTES DE SEGURANÇA\n\n18.1. Ao identificar um incidente, a CONTRATADA deverá registrar e investigar o evento, conter riscos, preservar evidências, avaliar alcance e comunicar a CONTRATANTE sem demora injustificada quando envolver dados tratados em seu nome, informando progressivamente fatos conhecidos, possíveis dados afetados, riscos e providências.\n\n19. RESPONSABILIDADE, TERCEIROS E ALTERAÇÕES\n\n19.1. Cada parte responderá por suas ações e omissões conforme a legislação aplicável. A CONTRATADA não garante volume de leads, entrega de mensagens por terceiros ou resultado comercial, mas permanece responsável por suas próprias obrigações contratuais, técnicas e de proteção de dados.\n\n19.2. Suspensões, bloqueios, alterações de preços ou políticas de provedores externos serão comunicados quando conhecidos e poderão demandar adaptação da integração. Alterações que reduzam materialmente do escopo, aumentem preço ou modifiquem o tratamento de dados exigirão informação prévia adequada.\n\n19.3. Serviços não disponíveis no plano, novas integrações, serviços profissionais e ampliações de limite dependerão de contratação própria. Eventual alteração deste contrato será registrada com número de versão e evidência de aceite.\n\n20. PROPRIEDADE INTELECTUAL\n\n20.1. Código, marca, documentação, interface e metodologia próprios do AXIVA CRM pertencem a seus titulares. Os dados inseridos ou importados pela CONTRATANTE continuam sob seus direitos e responsabilidades.\n\n20.2. É vedado copiar, sublicenciar, revender, realizar engenharia reversa não autorizada ou disponibilizar acessos a terceiros fora das condições contratadas.\n\n21. LEI APLICÁVEL E SOLUÇÃO DE CONFLITOS\n\n21.1. Aplica-se a legislação brasileira, inclusive LGPD, Marco Civil da Internet e Código de Defesa do Consumidor quando cabível à relação concreta. As partes buscarão solução direta pelos canais registrados antes de eventual demanda judicial.\n\n22. DO FORO E SOLUÇÃO DE CONFLITOS\n\n22.1. Eventuais divergências decorrentes deste contrato serão, prioritariamente, objeto de tentativa de composição amigável entre os representantes legais das Partes.\n\n22.2. Não havendo acordo, fica eleito o Foro Central da Comarca de São Paulo/SP para solucionar qualquer litígio oriundo deste instrumento, renunciando as partes a qualquer outro foro, por mais especial ou privilegiado que seja.\n\nANEXO I — PLANOS OFERECIDOS PELA CONTRATADA:\n\nPlano AXIVA - R$45,00 / mês por usuário\n- Gestão de leads e clientes\n- Funil de vendas / Kanban\n- WhatsApp\n- Campanhas\n- E-mail\n- Captação automática de até 160 leads por mês\n- Importação de contatos\n- AXIVA IA - até 10 interações por dia\n- Indicadores e acompanhamento\n\nPlano AXIVA Plus - R$79,80 / mês por usuário\n- Gestão de leads e clientes\n- Funil de vendas / Kanban\n- WhatsApp\n- Campanhas\n- E-mail\n- Captação automática de até 450 leads por mês\n- Importação de contatos\n- AXIVA IA - até 25 interações por dia\n- Indicadores e acompanhamento\n\nPlano AXIVA Max - R$164,80 / mês por usuário\n- Gestão de leads e clientes\n- Funil de vendas / Kanban\n- WhatsApp\n- Campanhas\n- E-mail\n- Captação automática de até 1.000 leads por mês\n- Importação de contatos\n- AXIVA IA - até 30 interações por dia\n\nANEXO II — ACORDO DE NÍVEL DE SERVIÇO (SLA)\n\n1. Disponibilidade: janela máxima de parada não programada do núcleo do CRM de 8 horas acumuladas por mês, aferidas conforme a cláusula 16.\n\n2. Severidade 1 — CRÍTICA: sistema fora do ar, perda de função principal, perda ou corrupção relevante de dados, falha de isolamento entre empresas ou incidente grave de segurança. Primeira resposta: até 1 (uma) hora. Resolução ou contorno seguro: até 8 (oito) horas, contadas do registro do chamado dentro do horário de atendimento estabelecido na cláusula 16.\n\n3. Severidade 2 — ALTA: função importante com falha, existindo contorno temporário. Primeira resposta: objetivo de 1 hora, limite de 3 horas. Resolução ou contorno: objetivo de 8 horas, limite de 12 horas, contados do registro do chamado dentro da janela aplicável.\n\n4. Severidade 3 — MÉDIA: dúvidas de utilização ou problemas de impacto moderado sem interrupção do núcleo. Primeira resposta: objetivo de 8 horas, limite de 24 horas. Resolução ou orientação conclusiva: objetivo de 8 horas, limite de 12 horas APÓS A PRIMEIRA RESPOSTA, dentro da janela aplicável, para evitar que o prazo de solução vença antes do prazo de resposta.\n\n5. Severidade 4 — BAIXA: pequenos bugs visuais e sugestões de melhoria sem impacto operacional relevante. Primeira resposta: objetivo de 8 horas, limite de 24 horas. Resolução: encaminhamento à fila de produção, sem prazo fixo de implementação; a CONTRATADA informará o encaminhamento.\n\nProcedimento\n\nRegistrar chamado, severidade, horário, evidências, responsável, respostas, medidas de contorno e encerramento; reclassificações deverão ser justificadas. Dependências externas e falhas de integração devem ser identificadas e acompanhadas; se afetarem o núcleo do CRM, serão computadas na disponibilidade."


const PLANS = {
  axiva: { name: 'AXIVA', price: 'R$ 45,00/mês', value: 45 },
  axiva_plus: { name: 'AXIVA Plus', price: 'R$ 79,80/mês', value: 79.8 },
  axiva_max: { name: 'AXIVA Max', price: 'R$ 164,80/mês', value: 164.8 },
}

export default function BillingContractScreen({ planId, licenseQuantity = 1, onBack, onContinue, paidSignup, inviteUser = null }) {
  const [signerName, setSignerName] = useState(() => paidSignup?.fullName || '')
  const [accepted, setAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const plan = useMemo(() => PLANS[planId], [planId])

  async function acceptContract() {
    if (loading || !plan) return
    setError('')
    if (signerName.trim().length < 2) {
      setError('Informe o nome do responsável pela contratação.')
      return
    }
    if (!accepted) {
      setError('Leia o contrato e marque a opção de concordância para continuar.')
      return
    }

    setLoading(true)
    try {
      let data
      let rpcError

      if (paidSignup) {
        const result = await supabase.rpc('prepare_axiva_paid_contract_v2', {
          p_cnpj: paidSignup.cnpj,
          p_organization_name: paidSignup.organizationName,
          p_plan_id: planId,
          p_contract_version: AXIVA_PAID_CONTRACT_VERSION,
          p_signer_name: signerName.trim(),
          p_user_agent: navigator.userAgent,
          p_license_quantity: licenseQuantity,
        })
        data = result.data
        rpcError = result.error
      } else {
        const result = await supabase.rpc('accept_axiva_paid_contract_v2', {
        p_plan_id: planId,
        p_contract_version: AXIVA_PAID_CONTRACT_VERSION,
        p_signer_name: signerName.trim(),
          p_user_agent: navigator.userAgent,
          p_license_quantity: licenseQuantity,
        })
        data = result.data
        rpcError = result.error
      }

      if (rpcError) throw rpcError
      if (!data) throw new Error('Não foi possível registrar a aceitação do contrato.')

      if (inviteUser) {
        const result = await supabase.functions.invoke('invite-org-user', {
          body: {
            name: inviteUser.name,
            email: inviteUser.email,
            role: inviteUser.role,
            planId: planId
          }
        })

        let inviteData = result.data
        if (typeof inviteData === 'string') {
          try { inviteData = JSON.parse(inviteData) } catch {}
        }

        if (result.error || inviteData?.error) {
          throw new Error(inviteData?.error || result.error?.message || 'Não foi possível preparar o pagamento do novo usuário.')
        }

        let checkoutUrl = inviteData?.checkoutUrl || inviteData?.link || ''
        if (!checkoutUrl && inviteData?.checkoutId) {
          checkoutUrl = `https://sandbox.asaas.com/checkoutSession/show?id=${encodeURIComponent(inviteData.checkoutId)}`
        }
        if (!checkoutUrl) {
          throw new Error('O pagamento do novo usuário foi preparado, mas o link do Asaas não foi retornado.')
        }

        window.location.assign(checkoutUrl)
        return
      }

      await onContinue()
    } catch (err) {
      setError(err?.message || 'Não foi possível registrar o contrato.')
      setLoading(false)
    }
  }

  if (!plan) return null

  return (
    <main className="auth-shell" style={{ minHeight: '100vh', padding: '32px 20px', alignItems: 'flex-start', overflowY: 'auto' }}>
      <section className="auth-card" style={{ width: 'min(820px, 100%)', maxWidth: 820, margin: '20px auto', padding: '32px' }}>
        <button
          type="button"
          className="text-button"
          onClick={onBack}
          disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 18 }}
        >
          <ArrowLeft size={16} /> Voltar
        </button>

        <div className="brand-mark">AX</div>
        <span className="eyebrow">CONTRATO DE USO</span>
        <h1 style={{ marginBottom: 8 }}>Contrato de Licença e Uso do AXIVA CRM</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Plano selecionado: <strong>{plan.name}</strong> — {plan.price} por usuário · {licenseQuantity} {licenseQuantity === 1 ? 'usuário' : 'usuários'} · <strong>{(plan.value * licenseQuantity).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês</strong>
        </p>

        <div
          style={{
            marginTop: 22,
            padding: '22px 24px',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            background: '#fff',
            maxHeight: 520,
            overflowY: 'auto',
            lineHeight: 1.65,
            color: '#334155',
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <FileText size={18} />
            <strong>Versão {AXIVA_PAID_CONTRACT_VERSION}</strong>
          </div>
          {CONTRACT_TEXT}
        </div>

        <label style={{ marginTop: 20 }}>
          Nome do responsável pela contratação
          <input
            value={signerName}
            onChange={e => setSignerName(e.target.value)}
            placeholder="Nome completo"
            maxLength={120}
            autoComplete="name"
            disabled={loading}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 16, cursor: loading ? 'default' : 'pointer' }}>
          <input
            type="checkbox"
            checked={accepted}
            onChange={e => setAccepted(e.target.checked)}
            disabled={loading}
            style={{ width: 18, height: 18, marginTop: 3, flex: '0 0 auto' }}
          />
          <span>
            Li o contrato acima e estou de acordo com suas condições. Confirmo que estou autorizado a realizar esta contratação em nome da empresa.
          </span>
        </label>

        {error && <div className="notice error" role="alert" style={{ marginTop: 16 }}>{error}</div>}

        <button className="primary full" type="button" onClick={acceptContract} disabled={loading || !accepted} style={{ marginTop: 20, minHeight: 44 }}>
          {loading ? <><Loader2 size={16} className="spin" /> Preparando pagamento...</> : <><CheckCircle2 size={17} /> Aceitar contrato e continuar para pagamento</>}
        </button>

        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          O pagamento será realizado em uma página segura. Os dados do cartão não são armazenados pelo AXIVA CRM.
        </p>
      </section>

      <style>{`
        .spin { animation: axiva-spin .9s linear infinite; }
        @keyframes axiva-spin { to { transform: rotate(360deg); } }
      `}</style>
    </main>
  )
}
