'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Message {
  role: 'user' | 'assistant'
  content: string
  tools?: string[]
}

const SUGESTOES = [
  'Quais tabelas estão disponíveis no banco?',
  'Quantos registros tem a maior tabela?',
  'Mostre os dados mais recentes de funcionários',
  'Faça um resumo do que há no banco de dados',
]

function MarkdownText({ text }: { text: string }) {
  // Renderização simples de markdown (negrito, código, tabelas, listas)
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Bloco de código
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <div key={i} className="my-2 rounded-lg overflow-hidden border border-slate-200">
          {lang && (
            <div className="bg-slate-700 text-slate-300 text-xs px-3 py-1 font-mono">{lang}</div>
          )}
          <pre className="bg-slate-800 text-green-300 text-xs p-3 overflow-x-auto font-mono whitespace-pre">
            {codeLines.join('\n')}
          </pre>
        </div>
      )
      i++
      continue
    }

    // Tabela markdown
    if (line.startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      const rows = tableLines
        .filter(l => !l.match(/^\|[\s\-|]+\|$/))
        .map(l => l.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map(c => c.trim()))
      if (rows.length > 0) {
        elements.push(
          <div key={i} className="my-2 overflow-x-auto">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr className="bg-blue-50">
                  {rows[0].map((h, j) => (
                    <th key={j} className="border border-slate-200 px-3 py-1.5 text-left font-semibold text-slate-700">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1).map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="border border-slate-200 px-3 py-1.5 text-slate-700 font-mono">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      continue
    }

    // Títulos
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="font-bold text-slate-800 mt-3 mb-1">{line.slice(4)}</h3>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="font-bold text-slate-800 text-base mt-3 mb-1">{line.slice(3)}</h2>)
    } else if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="font-bold text-slate-800 text-lg mt-3 mb-1">{line.slice(2)}</h1>)
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <li key={i} className="ml-4 list-disc text-slate-700">
          <InlineMarkdown text={line.slice(2)} />
        </li>
      )
    } else if (line.trim() === '') {
      elements.push(<br key={i} />)
    } else {
      elements.push(
        <p key={i} className="text-slate-700 leading-relaxed">
          <InlineMarkdown text={line} />
        </p>
      )
    }
    i++
  }

  return <div className="space-y-0.5">{elements}</div>
}

function InlineMarkdown({ text }: { text: string }) {
  // Negrito, itálico, código inline
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="bg-slate-100 text-blue-700 px-1 rounded font-mono text-xs">{part.slice(1, -1)}</code>
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={i}>{part.slice(1, -1)}</em>
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

export default function ChatPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeTools, setActiveTools] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeTools])

  async function send(text?: string) {
    const userText = (text ?? input).trim()
    if (!userText || loading) return

    const userMsg: Message = { role: 'user', content: userText }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    setActiveTools([])

    // Mensagem do assistente vazia que será preenchida via stream
    let assistantContent = ''
    const assistantTools: string[] = []
    setMessages(prev => [...prev, { role: 'assistant', content: '', tools: [] }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (!res.ok) { router.push('/login'); return }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw) continue

          const event = JSON.parse(raw)

          if (event.type === 'text') {
            assistantContent += event.text
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = {
                role: 'assistant',
                content: assistantContent,
                tools: assistantTools,
              }
              return updated
            })
          } else if (event.type === 'tool_start') {
            assistantTools.push(event.name)
            setActiveTools([...assistantTools])
          } else if (event.type === 'tool_end') {
            setActiveTools(prev => prev.filter(t => t !== event.name))
          } else if (event.type === 'error') {
            assistantContent += '\n' + event.text
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { role: 'assistant', content: assistantContent, tools: assistantTools }
              return updated
            })
          }
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: 'Erro de conexão. Tente novamente.', tools: [] }
        return updated
      })
    } finally {
      setLoading(false)
      setActiveTools([])
      textareaRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const toolLabels: Record<string, string> = {
    listar_tabelas: 'Listando tabelas',
    ver_schema: 'Lendo schema',
    executar_query: 'Executando query',
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-blue-900 text-white px-6 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <div>
            <h1 className="text-lg font-bold leading-none">Assistente IA</h1>
            <p className="text-blue-300 text-xs">Prefeitura de Arujá — dados em linguagem natural</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-blue-300 hover:text-white text-sm transition-colors">
            ← Dashboard
          </Link>
          <button
            onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/login') }}
            className="text-blue-300 hover:text-white text-sm transition-colors"
          >
            Sair
          </button>
        </div>
      </header>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 max-w-4xl mx-auto w-full">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-blue-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-700 mb-2">Olá! Como posso ajudar?</h2>
            <p className="text-slate-500 text-sm mb-8 max-w-md">
              Faça perguntas sobre os dados municipais em linguagem natural. Vou consultar o banco Sybase IQ e trazer as respostas.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
              {SUGESTOES.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left px-4 py-3 bg-white border border-slate-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 text-sm text-slate-600 transition-colors shadow-sm"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center flex-shrink-0 mr-3 mt-1">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                )}
                <div className={`max-w-[85%] ${msg.role === 'user'
                  ? 'bg-blue-700 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm'
                  : 'bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm'
                }`}>
                  {msg.role === 'user' ? (
                    <p className="text-sm">{msg.content}</p>
                  ) : msg.content ? (
                    <MarkdownText text={msg.content} />
                  ) : (
                    <div className="flex items-center gap-2 text-slate-400 text-sm">
                      <span className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Indicador de ferramentas ativas */}
            {activeTools.length > 0 && (
              <div className="flex justify-start">
                <div className="w-8 h-8 mr-3 flex-shrink-0" />
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 flex items-center gap-2 text-sm text-amber-700">
                  <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {toolLabels[activeTools[activeTools.length - 1]] ?? activeTools[activeTools.length - 1]}...
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="bg-white border-t border-slate-200 px-4 py-4">
        <div className="max-w-4xl mx-auto flex gap-3 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            rows={1}
            placeholder="Pergunte sobre os dados municipais... (Enter para enviar)"
            className="flex-1 border border-slate-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-gray-900 disabled:opacity-50"
            style={{ maxHeight: '160px', overflowY: 'auto' }}
            onInput={e => {
              const t = e.currentTarget
              t.style.height = 'auto'
              t.style.height = Math.min(t.scrollHeight, 160) + 'px'
            }}
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="bg-blue-700 hover:bg-blue-800 text-white p-3 rounded-xl transition-colors disabled:opacity-40 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-slate-400 text-center mt-2">Shift+Enter para nova linha · Enter para enviar</p>
      </div>
    </div>
  )
}
