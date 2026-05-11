import Anthropic from '@anthropic-ai/sdk'
import { getSchemaContext } from './schema-cache'

export interface CatalogEntry {
  tabela: string
  descricao: string
  conceitos: string[]           // termos de negócio que mapeiam para essa tabela
  colunas_chave: Record<string, string>  // nome_coluna → descrição negócio
  joins_comuns: string[]        // outras tabelas que costumam ser usadas em conjunto
}

export interface Catalog {
  gerado_em: string
  entradas: CatalogEntry[]
  mapa_conceitos: Record<string, string[]>  // conceito → [tabelas]
}

let cachedCatalog: Catalog | null = null
let buildInProgress = false

export function getCatalog(): Catalog | null {
  return cachedCatalog
}

export function isBuildInProgress(): boolean {
  return buildInProgress
}

export async function buildCatalog(
  onProgress: (msg: string) => void
): Promise<Catalog> {
  if (buildInProgress) throw new Error('Build já em andamento')
  buildInProgress = true

  try {
    onProgress('Carregando schema do banco...')
    const schemaContext = await getSchemaContext(true)

    onProgress('Analisando tabelas com IA...')
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: `Você é um especialista em sistemas de gestão pública brasileira (contabilidade pública, RH, orçamento, compras, patrimonial).

Analise o schema abaixo do banco Sybase IQ da Prefeitura de Arujá (SP) e gere um catálogo de dados semântico.

Para CADA tabela identificada, determine:
1. O que ela representa em linguagem de negócio
2. Quais conceitos/perguntas ela responde (ex: "despesas", "secretaria", "fornecedor", "folha de pagamento")
3. Quais são as colunas mais importantes e o que significam em português claro
4. Com quais outras tabelas ela normalmente é combinada em JOINs

Use seu conhecimento sobre nomenclaturas típicas de sistemas públicos brasileiros:
- FATO_ = tabela fato (dados transacionais)
- DIM_ = tabela dimensão (dados cadastrais/descritivos)
- BIORC = orçamentário
- EMP = empenho
- LIQ = liquidação
- PAG = pagamento
- RH = recursos humanos / pessoal
- COMP = compras/licitações
- PAT = patrimônio
- INS/ORG = institucional (secretarias/órgãos)
- CD_ = código
- DS_ = descrição
- VL_ = valor
- DT_ = data
- NR_ = número

SCHEMA:
${schemaContext}

Retorne APENAS um JSON válido neste formato exato (sem texto antes ou depois):
{
  "entradas": [
    {
      "tabela": "NOME_EXATO_DA_TABELA",
      "descricao": "O que essa tabela representa em 1-2 frases",
      "conceitos": ["lista", "de", "termos", "de", "negócio"],
      "colunas_chave": {
        "NOME_COLUNA": "O que essa coluna significa"
      },
      "joins_comuns": ["OUTRA_TABELA_1", "OUTRA_TABELA_2"]
    }
  ],
  "mapa_conceitos": {
    "despesas": ["TABELA_A", "TABELA_B"],
    "secretaria": ["TABELA_C"],
    "fornecedor": ["TABELA_D"],
    "funcionarios": ["TABELA_E"],
    "folha pagamento": ["TABELA_F"],
    "orcamento": ["TABELA_G"],
    "empenho": ["TABELA_H"],
    "liquidacao": ["TABELA_I"],
    "pagamento": ["TABELA_J"],
    "licitacao": ["TABELA_K"],
    "patrimonio": ["TABELA_L"]
  }
}`
        }
      ]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

    // Extrai JSON da resposta
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('IA não retornou JSON válido')

    const parsed = JSON.parse(jsonMatch[0]) as Omit<Catalog, 'gerado_em'>

    const catalog: Catalog = {
      gerado_em: new Date().toISOString(),
      ...parsed,
    }

    cachedCatalog = catalog
    onProgress(`Catálogo gerado: ${catalog.entradas.length} tabelas mapeadas`)
    return catalog
  } finally {
    buildInProgress = false
  }
}

export function catalogToPromptContext(catalog: Catalog): string {
  const lines: string[] = [
    '══════════════════════════════════════════',
    'CATÁLOGO DE DADOS — DICIONÁRIO SEMÂNTICO',
    `(gerado em ${new Date(catalog.gerado_em).toLocaleString('pt-BR')})`,
    '══════════════════════════════════════════',
    '',
    '## Mapeamento de Conceitos → Tabelas',
  ]

  for (const [conceito, tabelas] of Object.entries(catalog.mapa_conceitos)) {
    lines.push(`• ${conceito}: ${tabelas.join(', ')}`)
  }

  lines.push('', '## Descrição das Tabelas')

  for (const entry of catalog.entradas) {
    lines.push(``, `### pref_aruja_sp.${entry.tabela}`)
    lines.push(`${entry.descricao}`)
    if (entry.conceitos.length) {
      lines.push(`Responde perguntas sobre: ${entry.conceitos.join(', ')}`)
    }
    if (Object.keys(entry.colunas_chave).length) {
      lines.push('Colunas principais:')
      for (const [col, desc] of Object.entries(entry.colunas_chave)) {
        lines.push(`  - ${col}: ${desc}`)
      }
    }
    if (entry.joins_comuns.length) {
      lines.push(`JOINs comuns: ${entry.joins_comuns.join(', ')}`)
    }
  }

  return lines.join('\n')
}
