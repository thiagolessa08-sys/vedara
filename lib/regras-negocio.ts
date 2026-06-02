/**
 * Regras de negócio que a IA deve seguir antes de executar qualquer consulta.
 * Adicione novas regras aqui — elas são injetadas automaticamente no system prompt.
 */

export const REGRAS_NEGOCIO = `
══════════════════════════════════════════
REGRAS DE NEGÓCIO — OBRIGATÓRIAS
══════════════════════════════════════════

## REGRA 1 — FATURAMENTO: usar EZ_VEDDARA_INVOICE_ORDER + INVOICE_ITEM

Toda vez que o usuário perguntar sobre faturamento, receita ou valor faturado,
use SEMPRE a tabela EZ_VEDDARA_INVOICE_ORDER (cabeçalho) com JOIN em
EZ_VEDDARA_INVOICE_ITEM (itens) e filtre Status = 1 (notas emitidas, não canceladas).

  • Valor faturado total → SUM(ii.TOTAL_SALE_PRICE) nos itens
  • NUNCA some valores do cabeçalho diretamente — o detalhe fica nos itens
  • Sempre filtre: WHERE io.Status = 1  (exclui notas canceladas)

## REGRA 2 — STATUS DAS ENTIDADES

Cada tabela principal tem uma coluna Status com os seguintes valores comuns:
  • EZ_VEDDARA_INVOICE_ORDER: 1=Emitida, 2=Cancelada
  • EZ_VEDDARA_SALE_ORDER:    1=Aberto, 2=Faturado, 3=Cancelado
  • EZ_VEDDARA_ESTIMATE_ORDER: 1=Aberto, 2=Aprovado, 3=Cancelado, 4=Expirado
  • EZ_VEDDARA_CUSTOMER_CUSTOMER: 1=Ativo, 2=Inativo
  • EZ_VEDDARA_SALE_SALESPERSON: 1=Ativo, 2=Inativo

SEMPRE aplique filtro de Status nas consultas de análise:
  • Clientes ativos: WHERE Status = 1
  • Notas emitidas: WHERE Status = 1
  • Pedidos ativos (não cancelados): WHERE Status IN (1, 2)

## REGRA 3 — JOINS PRINCIPAIS

Os relacionamentos mais usados:
  • Cliente ↔ Pedido de Venda:    EZ_VEDDARA_SALE_ORDER.CustomerId = EZ_VEDDARA_CUSTOMER_CUSTOMER.Id
  • Cliente ↔ Nota Fiscal:        EZ_VEDDARA_INVOICE_ORDER.CustomerId = EZ_VEDDARA_CUSTOMER_CUSTOMER.Id
  • Vendedor ↔ Pedido de Venda:   EZ_VEDDARA_SALE_ORDER.SalespersonId = EZ_VEDDARA_SALE_SALESPERSON.Id
  • Cabeçalho ↔ Itens Venda:      EZ_VEDDARA_SALE_ITEM.OrderId = EZ_VEDDARA_SALE_ORDER.Id
  • Cabeçalho ↔ Itens NF:         EZ_VEDDARA_INVOICE_ITEM.OrderId = EZ_VEDDARA_INVOICE_ORDER.Id
  • Cabeçalho ↔ Itens Orçamento:  EZ_VEDDARA_ESTIMATE_ITEM.OrderId = EZ_VEDDARA_ESTIMATE_ORDER.Id
  • Orçamento → Pedido de Venda:  EZ_VEDDARA_ESTIMATE_ORDER.SalesOrderId = EZ_VEDDARA_SALE_ORDER.Id
  • Pedido → Nota Fiscal:         EZ_VEDDARA_SALE_ORDER.InvoiceId = EZ_VEDDARA_INVOICE_ORDER.Id

## REGRA 4 — COMISSÕES

Comissões ficam nos itens (SALE_ITEM, INVOICE_ITEM, ESTIMATE_ITEM):
  • CommissionSalesperson         → valor da comissão do vendedor no item
  • CommissionSalespersonPercentage → percentual de comissão
  • CommissionAgent               → comissão do agente
  • CommissionSupervisor          → comissão do supervisor

Para calcular comissão total de um vendedor, some CommissionSalesperson dos itens.
`
