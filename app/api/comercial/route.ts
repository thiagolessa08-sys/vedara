import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { agentQuery } from '@/lib/agent'

export interface DadosComercial {
  kpis: {
    faturamentoTotal: number
    faturamentoAnoCorrente: number
    faturamentoAnoAnterior: number
    crescimentoYoY: number
    pipelineAberto: number
    pipelineQtd: number
    clientesAtivos: number
    ticketMedio: number
    winRate: number
  }
  mensal: Array<{ anomes: string; faturamento: number; notas: number }>
  anual: Array<{ ano: string; faturamento: number; notas: number }>
  topClientes: Array<{ nome: string; faturamento: number; notas: number }>
  topVendedores: Array<{ nome: string; faturamento: number; notas: number }>
  topProdutos: Array<{ nome: string; faturamento: number }>
  funil: { convertidos: number; perdidos: number; abertos: number; valorPipeline: number }
  novosClientes: Array<{ ano: string; qtd: number }>
}

const ST = 'Status = 100' // status de documento válido/finalizado

// Helpers para extrair valores das linhas
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown): string => String(v ?? '').trim()

export async function GET() {
  const session = getSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  try {
    const [
      qFatTotal,
      qFatAnual,
      qFatMensal,
      qTopClientes,
      qTopVendedores,
      qTopProdutos,
      qFunil,
      qClientesAtivos,
      qNovosClientes,
    ] = await Promise.all([
      agentQuery(`
        SELECT YEAR(io.DateInvoiceOrder) AS ano, SUM(ii.TOTAL_SALE_PRICE) AS fat, COUNT(DISTINCT io.Id) AS notas
        FROM veddara.EZ_VEDDARA_INVOICE_ORDER io
        JOIN veddara.EZ_VEDDARA_INVOICE_ITEM ii ON io.Id = ii.OrderId
        WHERE io.${ST}
        GROUP BY YEAR(io.DateInvoiceOrder)`, 100),
      agentQuery(`
        SELECT YEAR(io.DateInvoiceOrder) AS ano, SUM(ii.TOTAL_SALE_PRICE) AS fat, COUNT(DISTINCT io.Id) AS notas
        FROM veddara.EZ_VEDDARA_INVOICE_ORDER io
        JOIN veddara.EZ_VEDDARA_INVOICE_ITEM ii ON io.Id = ii.OrderId
        WHERE io.${ST} AND YEAR(io.DateInvoiceOrder) >= 2022
        GROUP BY YEAR(io.DateInvoiceOrder)
        ORDER BY ano`, 100),
      agentQuery(`
        SELECT YEAR(io.DateInvoiceOrder)*100 + MONTH(io.DateInvoiceOrder) AS anomes,
               SUM(ii.TOTAL_SALE_PRICE) AS fat, COUNT(DISTINCT io.Id) AS notas
        FROM veddara.EZ_VEDDARA_INVOICE_ORDER io
        JOIN veddara.EZ_VEDDARA_INVOICE_ITEM ii ON io.Id = ii.OrderId
        WHERE io.${ST} AND io.DateInvoiceOrder >= '2024-07-01'
        GROUP BY YEAR(io.DateInvoiceOrder)*100 + MONTH(io.DateInvoiceOrder)
        ORDER BY anomes`, 100),
      agentQuery(`
        SELECT TOP 10 c.Name AS nome, SUM(ii.TOTAL_SALE_PRICE) AS fat, COUNT(DISTINCT io.Id) AS notas
        FROM veddara.EZ_VEDDARA_INVOICE_ORDER io
        JOIN veddara.EZ_VEDDARA_INVOICE_ITEM ii ON io.Id = ii.OrderId
        JOIN veddara.EZ_VEDDARA_CUSTOMER_CUSTOMER c ON io.CustomerId = c.Id
        WHERE io.${ST}
        GROUP BY c.Name
        ORDER BY fat DESC`, 50),
      agentQuery(`
        SELECT TOP 10 sp.Firstname || ' ' || ISNULL(sp.LastName, '') AS nome,
               SUM(ii.TOTAL_SALE_PRICE) AS fat, COUNT(DISTINCT io.Id) AS notas
        FROM veddara.EZ_VEDDARA_INVOICE_ORDER io
        JOIN veddara.EZ_VEDDARA_INVOICE_ITEM ii ON io.Id = ii.OrderId
        JOIN veddara.EZ_VEDDARA_SALE_SALESPERSON sp ON io.SalespersonId = sp.Id
        WHERE io.${ST}
        GROUP BY sp.Firstname, sp.LastName
        ORDER BY fat DESC`, 50),
      agentQuery(`
        SELECT TOP 10 ii.Description AS nome, SUM(ii.TOTAL_SALE_PRICE) AS fat
        FROM veddara.EZ_VEDDARA_INVOICE_ORDER io
        JOIN veddara.EZ_VEDDARA_INVOICE_ITEM ii ON io.Id = ii.OrderId
        WHERE io.${ST}
        GROUP BY ii.Description
        ORDER BY fat DESC`, 50),
      agentQuery(`
        SELECT eo.Status, COUNT(DISTINCT eo.Id) AS qtd, SUM(ei.TOTAL_SALE_PRICE) AS valor
        FROM veddara.EZ_VEDDARA_ESTIMATE_ORDER eo
        JOIN veddara.EZ_VEDDARA_ESTIMATE_ITEM ei ON eo.Id = ei.OrderId
        GROUP BY eo.Status`, 50),
      agentQuery(`
        SELECT COUNT(*) AS ativos FROM veddara.EZ_VEDDARA_CUSTOMER_CUSTOMER WHERE Status = 1`, 10),
      agentQuery(`
        SELECT YEAR(CreateDate) AS ano, COUNT(*) AS qtd
        FROM veddara.EZ_VEDDARA_CUSTOMER_CUSTOMER
        WHERE CreateDate IS NOT NULL AND YEAR(CreateDate) >= 2020
        GROUP BY YEAR(CreateDate)
        ORDER BY ano`, 50),
    ])

    // Faturamento por ano (mapa ano -> valor)
    const fatPorAno = new Map<number, { fat: number; notas: number }>()
    for (const r of qFatTotal.rows) {
      fatPorAno.set(num(r[0]), { fat: num(r[1]), notas: num(r[2]) })
    }
    const faturamentoTotal = [...fatPorAno.values()].reduce((s, v) => s + v.fat, 0)

    // Ano corrente = maior ano presente nos dados
    const anos = [...fatPorAno.keys()].sort((a, b) => b - a)
    const anoCorrente = anos[0] ?? 0
    const anoAnterior = anoCorrente - 1
    const fatAnoCorrente = fatPorAno.get(anoCorrente)?.fat ?? 0
    const fatAnoAnterior = fatPorAno.get(anoAnterior)?.fat ?? 0
    const notasAnoCorrente = fatPorAno.get(anoCorrente)?.notas ?? 0
    const crescimentoYoY = fatAnoAnterior > 0
      ? ((fatAnoCorrente - fatAnoAnterior) / fatAnoAnterior) * 100
      : 0
    const ticketMedio = notasAnoCorrente > 0 ? fatAnoCorrente / notasAnoCorrente : 0

    // Funil de orçamentos
    let convertidos = 0, perdidos = 0, abertos = 0, valorPipeline = 0
    for (const r of qFunil.rows) {
      const st = num(r[0]); const qtd = num(r[1]); const valor = num(r[2])
      if (st === 100) convertidos += qtd            // finalizado → virou pedido
      else if (st === 99) perdidos += qtd           // cancelado/perdido
      else if (st === 2 || st === 1) {              // em aberto
        abertos += qtd
        valorPipeline += valor
      }
    }
    const winRate = (convertidos + perdidos) > 0
      ? (convertidos / (convertidos + perdidos)) * 100
      : 0

    const dados: DadosComercial = {
      kpis: {
        faturamentoTotal,
        faturamentoAnoCorrente: fatAnoCorrente,
        faturamentoAnoAnterior: fatAnoAnterior,
        crescimentoYoY,
        pipelineAberto: valorPipeline,
        pipelineQtd: abertos,
        clientesAtivos: num(qClientesAtivos.rows[0]?.[0]),
        ticketMedio,
        winRate,
      },
      anual: qFatAnual.rows.map(r => ({
        ano: str(r[0]),
        faturamento: num(r[1]),
        notas: num(r[2]),
      })),
      mensal: qFatMensal.rows.map(r => ({
        anomes: str(r[0]),
        faturamento: num(r[1]),
        notas: num(r[2]),
      })),
      topClientes: qTopClientes.rows.map(r => ({
        nome: str(r[0]),
        faturamento: num(r[1]),
        notas: num(r[2]),
      })),
      topVendedores: qTopVendedores.rows.map(r => ({
        nome: str(r[0]),
        faturamento: num(r[1]),
        notas: num(r[2]),
      })),
      topProdutos: qTopProdutos.rows.map(r => ({
        nome: str(r[0]),
        faturamento: num(r[1]),
      })),
      funil: { convertidos, perdidos, abertos, valorPipeline },
      novosClientes: qNovosClientes.rows.map(r => ({
        ano: str(r[0]),
        qtd: num(r[1]),
      })),
    }

    return NextResponse.json(dados)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
