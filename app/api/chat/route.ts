import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { agentQuery, listSchemaTables, agentSchema } from '@/lib/agent'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'listar_tabelas',
    description: 'Lista todas as tabelas e views disponíveis no schema pref_aruja_sp do banco Sybase IQ da Prefeitura de Arujá.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ver_schema',
    description: 'Retorna as colunas (nome, tipo, nullable) de uma tabela para entender sua estrutura antes de consultar.',
    input_schema: {
      type: 'object',
      properties: {
        tabela: { type: 'string', description: 'Nome da tabela (sem prefixo de schema)' },
      },
      required: ['tabela'],
    },
  },
  {
    name: 'executar_query',
    description: 'Executa uma query SELECT no Sybase IQ e retorna colunas, linhas e contagem. Apenas SELECT é permitido.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Query SELECT completa, usando pref_aruja_sp.nome_tabela' },
        limit: { type: 'number', description: 'Máximo de linhas a retornar (padrão 100, máximo 500)' },
      },
      required: ['sql'],
    },
  },
]

const SYSTEM = `Você é um assistente de análise de dados da Prefeitura de Arujá (SP).
Tem acesso ao banco de dados municipal Sybase IQ (schema: pref_aruja_sp, banco: IQHML).

Regras:
- Use as ferramentas para consultar dados reais antes de responder
- Sempre explore o schema antes de escrever queries (use ver_schema)
- Use TOP N no Sybase IQ para limitar linhas (não LIMIT)
- Nomeie colunas com aspas duplas se tiverem espaços: "Nome Coluna"
- Responda em português brasileiro, de forma clara e objetiva
- Para resultados tabulares, use tabelas markdown
- Ao exibir queries SQL, formate-as em blocos de código sql`

export async function POST(req: NextRequest) {
  const session = getSession()
  if (!session) return new Response('Não autenticado', { status: 401 })

  const { messages } = await req.json()

  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  async function send(payload: object) {
    await writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
  }

  async function run() {
    try {
      const msgs: Anthropic.MessageParam[] = [...messages]

      for (let turn = 0; turn < 10; turn++) {
        const response = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: SYSTEM,
          tools: TOOLS,
          messages: msgs,
        })

        // Stream texto da resposta
        for (const block of response.content) {
          if (block.type === 'text' && block.text) {
            await send({ type: 'text', text: block.text })
          }
        }

        if (response.stop_reason === 'end_turn') break

        // Processa tool calls
        if (response.stop_reason === 'tool_use') {
          msgs.push({ role: 'assistant', content: response.content })

          const toolResults: Anthropic.ToolResultBlockParam[] = []

          for (const block of response.content) {
            if (block.type !== 'tool_use') continue

            await send({ type: 'tool_start', name: block.name })

            let result: unknown
            try {
              if (block.name === 'listar_tabelas') {
                result = await listSchemaTables()
              } else if (block.name === 'ver_schema') {
                const input = block.input as { tabela: string }
                result = await agentSchema(`pref_aruja_sp.${input.tabela}`)
              } else if (block.name === 'executar_query') {
                const input = block.input as { sql: string; limit?: number }
                result = await agentQuery(input.sql, input.limit ?? 100)
              }
            } catch (e) {
              result = { error: String(e) }
            }

            await send({ type: 'tool_end', name: block.name })

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            })
          }

          msgs.push({ role: 'user', content: toolResults })
        }
      }
    } catch (e) {
      await send({ type: 'error', text: `Erro: ${String(e)}` })
    } finally {
      await send({ type: 'done' })
      await writer.close()
    }
  }

  run()

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
