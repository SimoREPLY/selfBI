import { lazy, Suspense, useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import { motion, MotionConfig, type Variants } from 'motion/react'
import type { ChartSpec } from './Chart'

// Recharts is the heaviest dependency and only needed once a result arrives:
// load it lazily, and start the download as soon as the user starts asking.
const loadChart = () => import('./Chart')
const Chart = lazy(() => loadChart().then((m) => ({ default: m.Chart })))

type Result = {
  answer: string
  sql: string | null
  columns: string[]
  rows: unknown[][]
  truncated: boolean
  chart: ChartSpec | null
}

// ponytail: chats live in memory only; persist them when people ask to keep them across reloads
type Entry = { id: number; question: string; result?: Result; error?: string }
type Conversation = { id: number; title: string; entries: Entry[] }

const EXAMPLES = [
  'Fatturato degli ultimi anni',
  'Fatturato mensile per categoria prodotto',
  'Top 10 clienti per fatturato',
  'Quota di vendite per segmento cliente',
]

// ponytail: the agent's answers only use **bold**; switch to a markdown renderer if it starts emitting lists or links
const withBold = (s: string) => s.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : p))

async function fetchAnswer(question: string): Promise<Result> {
  const res = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.detail ?? `HTTP ${res.status}`)
  return body
}

// Decimals always two places so a column of amounts lines up on the comma.
const cents = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cell = (v: number) => (Number.isInteger(v) ? v.toLocaleString('it-IT') : cents.format(v))

const narrow = () => matchMedia('(max-width: 767px)').matches

/* ---------- Icons: 20px, 1.75 stroke, currentColor ---------- */
const Icon = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)
const IconSidebar = () => (
  <Icon><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></Icon>
)
const IconNew = () => (
  <Icon><path d="M12 4H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-5" /><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L13 14l-4 1 1-4z" /></Icon>
)
const IconUp = () => (
  <Icon size={18}><path d="M12 19V5M6 11l6-6 6 6" /></Icon>
)
const IconCopy = () => (
  <Icon size={18}><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" /></Icon>
)
const IconCheck = () => (
  <Icon size={18}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>
)
const IconRetry = () => (
  <Icon size={18}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></Icon>
)
const IconChart = () => (
  <Icon size={18}><path d="M4 20h16" /><path d="M7 16v-5M12 16V7M17 16v-8" /></Icon>
)

/* ---------- Motion ---------- */
const spring = { type: 'spring', stiffness: 380, damping: 34 } as const
// Welcome sequence: mark, headline, composer, examples, one after the other.
const stagger: Variants = { show: { transition: { staggerChildren: 0.08, delayChildren: 0.3 } } }
const rise: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
}

// The mark: three blades rising left to right, a bar chart that grows. Same paths as public/favicon.svg.
const BLADES = ['M3 22Q3 15.5 8 13V22Z', 'M9.5 22Q9.5 12.5 14.5 8V22Z', 'M16 22Q16 9.5 21 3V22Z']
const Sprout = ({ size = 20, mode }: { size?: number; mode?: 'grow' | 'busy' }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} className={`sprout${mode === 'busy' ? ' sprout--busy' : ''}`} aria-hidden="true">
    {BLADES.map((d, i) =>
      mode === 'grow' ? (
        // blades spring up from the baseline in turn, with a little overshoot
        <motion.path key={d} d={d} style={{ originY: 1 }} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ type: 'spring', stiffness: 240, damping: 13, delay: 0.05 + i * 0.11 }} />
      ) : (
        <path key={d} d={d} />
      ),
    )}
  </svg>
)

export default function App() {
  const [draft, setDraft] = useState('')
  const [chats, setChats] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => !narrow())
  const active = chats.find((c) => c.id === activeId)
  const entries = active?.entries ?? []
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Follow the conversation: every new message or answer scrolls the thread to its end.
  const lastState = entries.map((e) => (e.result ? 'r' : e.error ? 'e' : 'p')).join('')
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [activeId, entries.length, lastState])

  function patchEntry(id: number, patch: Partial<Entry>) {
    setChats((cs) => cs.map((c) => ({ ...c, entries: c.entries.map((x) => (x.id === id ? { ...x, ...patch } : x)) })))
  }

  async function run(entryId: number, question: string) {
    setLoading(true)
    try {
      patchEntry(entryId, { result: await fetchAnswer(question), error: undefined })
    } catch (e) {
      patchEntry(entryId, { error: e instanceof Error ? e.message : String(e) })
    }
    setLoading(false)
  }

  function ask(raw: string) {
    const question = raw.trim()
    if (!question || loading) return
    loadChart()
    const id = Date.now()
    const entry: Entry = { id, question }
    if (active) {
      setChats((cs) => cs.map((c) => (c.id === active.id ? { ...c, entries: [...c.entries, entry] } : c)))
    } else {
      setChats((cs) => [{ id, title: question, entries: [entry] }, ...cs])
      setActiveId(id)
    }
    setDraft('')
    run(id, question)
  }

  function retry(entry: Entry) {
    if (loading) return
    patchEntry(entry.id, { result: undefined, error: undefined })
    run(entry.id, entry.question)
  }

  function newChat() {
    setActiveId(null)
    if (narrow()) setSidebarOpen(false)
    inputRef.current?.focus()
  }

  function openChat(id: number) {
    setActiveId(id)
    if (narrow()) setSidebarOpen(false)
  }

  const onSubmit = (e: SyntheticEvent) => {
    e.preventDefault()
    ask(draft)
  }

  const composer = (
    // One composer, two homes: centred on the welcome screen, docked under the thread.
    // The shared layoutId glides it from one to the other when the first question is sent.
    // layout="position": its size never animates, so the text inside never stretches while typing.
    <motion.form onSubmit={onSubmit} className="composer" layoutId="composer" layout="position" transition={spring} variants={rise}>
      <label htmlFor="q" className="sr-only">Fai una domanda sui dati di vendita</label>
      <textarea
        id="q"
        ref={inputRef}
        rows={1}
        value={draft}
        placeholder="Chiedi qualcosa sui dati di vendita"
        onFocus={loadChart}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) onSubmit(e)
        }}
      />
      <button type="submit" className="send" disabled={loading || !draft.trim()} aria-label={loading ? 'Analizzo i dati' : 'Invia la domanda'}>
        {loading ? <span className="send__stop" aria-hidden="true" /> : <IconUp />}
      </button>
    </motion.form>
  )

  return (
    <MotionConfig reducedMotion="user">
    <div className="shell" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
      <a className="skip-link" href="#q">Vai alla domanda</a>

      <aside id="sidebar" className="sidebar" aria-label="Chat">
        <div className="sidebar__top">
          <span className="logo display"><Sprout size={22} />self-BI</span>
          <button type="button" className="icon-btn" aria-label="Chiudi la barra laterale" aria-expanded={sidebarOpen} aria-controls="sidebar" onClick={() => setSidebarOpen(false)}>
            <IconSidebar />
          </button>
        </div>
        <button type="button" className="side-item side-item--new" onClick={newChat}>
          <IconNew />
          Nuova chat
        </button>
        <nav className="history" aria-labelledby="history-title">
          <h2 id="history-title">Chat</h2>
          {chats.length === 0 ? (
            <p className="history__empty">Le chat di questa sessione restano qui.</p>
          ) : (
            <ol>
              {chats.map((c) => (
                // a new chat drops in at the top and pushes the older ones down
                <motion.li key={c.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
                  <button type="button" className="side-item" aria-current={c.id === activeId} onClick={() => openChat(c.id)}>
                    <span>{c.title}</span>
                  </button>
                </motion.li>
              ))}
            </ol>
          )}
        </nav>
      </aside>
      <button type="button" className="scrim" aria-label="Chiudi la barra laterale" tabIndex={-1} onClick={() => setSidebarOpen(false)} />

      <div className="main">
        <header className="topbar">
          <div className="topbar__left">
            {!sidebarOpen && (
              <>
                <button type="button" className="icon-btn" aria-label="Apri la barra laterale" aria-expanded={false} aria-controls="sidebar" onClick={() => setSidebarOpen(true)}>
                  <IconSidebar />
                </button>
                <button type="button" className="icon-btn" aria-label="Nuova chat" onClick={newChat}>
                  <IconNew />
                </button>
              </>
            )}
            <span className="topbar__title display">self-BI <span>Vendite</span></span>
          </div>
          {loading && <div className="progress" aria-hidden="true" />}
        </header>

        <motion.main layoutScroll className={`thread${active ? '' : ' thread--empty'}`} aria-busy={loading}>
          <p className="sr-only" aria-live="polite">
            {loading ? 'Sto leggendo lo schema e scrivendo la query…' : ''}
          </p>
          {active ? (
            <div className="column">
              {entries.map((e) => (
                <Turn key={e.id} entry={e} onRetry={() => retry(e)} busy={loading} />
              ))}
              <div ref={endRef} className="thread__end" />
            </div>
          ) : (
            <motion.section className="welcome" initial="hidden" animate="show" variants={stagger}>
              <Sprout size={64} mode="grow" />
              <motion.h1 className="display" variants={rise}>Cosa vuoi sapere dalle vendite?</motion.h1>
              {composer}
              <motion.ul className="chips" aria-label="Domande di esempio" variants={rise}>
                {EXAMPLES.map((ex) => (
                  <li key={ex}>
                    <button type="button" onClick={() => ask(ex)} disabled={loading}>
                      <IconChart />
                      {ex}
                    </button>
                  </li>
                ))}
              </motion.ul>
            </motion.section>
          )}
        </motion.main>

        {active && <div className="dock"><div className="column">{composer}</div></div>}
        <p className="disclaimer">L'agente può sbagliare: controlla la query SQL prima di usare i numeri.</p>
      </div>
    </div>
    </MotionConfig>
  )
}

function Turn({ entry, onRetry, busy }: { entry: Entry; onRetry: () => void; busy: boolean }) {
  const { question, result, error } = entry
  return (
    <article className="turn">
      <motion.div className="msg-user" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} style={{ originX: 1, originY: 1 }} transition={spring}>
        <p>{question}</p>
      </motion.div>
      <div className="msg-bot">
        {!result && !error && (
          <p className="thinking">
            <Sprout size={20} mode="busy" />
            <span className="shimmer">Sto leggendo lo schema e scrivendo la query…</span>
          </p>
        )}
        {error && (
          <div className="error" role="alert">
            <p>Non sono riuscito a rispondere: {error}</p>
            <button type="button" className="btn" onClick={onRetry} disabled={busy}>
              <IconRetry />
              Riprova la domanda
            </button>
          </div>
        )}
        {result && <ResultView result={result} onRetry={onRetry} busy={busy} />}
      </div>
    </article>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="icon-btn icon-btn--sm"
      aria-label={done ? 'Copiato' : label}
      title={done ? 'Copiato' : label}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
    >
      {done ? <IconCheck /> : <IconCopy />}
    </button>
  )
}

function ResultView({ result, onRetry, busy }: { result: Result; onRetry: () => void; busy: boolean }) {
  const { answer, chart, columns, rows, truncated, sql } = result
  return (
    <div className="result">
      {answer && <p className="answer">{withBold(answer)}</p>}
      {chart && rows.length > 0 && (
        <Suspense fallback={<div className="card chart chart--loading" />}>
          <Chart spec={chart} columns={columns} rows={rows} />
        </Suspense>
      )}
      {columns.length > 0 && (
        <div className="card sheet">
          <div className="sheet__scroll">
            <table>
              <thead>
                <tr>
                  {columns.map((c, j) => (
                    <th key={c} className={typeof rows[0]?.[j] === 'number' ? 'num' : undefined}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className={typeof v === 'number' ? 'num' : undefined}>
                        {typeof v === 'number' ? cell(v) : String(v ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="rowcount">
            {rows.length} {rows.length === 1 ? 'riga' : 'righe'}
            {truncated && ', risultato troncato'}
          </p>
        </div>
      )}
      {sql && (
        <details className="card sql">
          <summary>
            <span className="sql__lang">SQL</span>
            <span className="sql__toggle">Mostra la query</span>
          </summary>
          <div className="sql__body">
            <div className="sql__copy"><CopyButton text={sql} label="Copia la query SQL" /></div>
            <pre>{sql}</pre>
          </div>
        </details>
      )}
      <div className="actions">
        {answer && <CopyButton text={answer.replace(/\*\*/g, '')} label="Copia la risposta" />}
        <button type="button" className="icon-btn icon-btn--sm" aria-label="Rigenera la risposta" title="Rigenera la risposta" onClick={onRetry} disabled={busy}>
          <IconRetry />
        </button>
      </div>
    </div>
  )
}
