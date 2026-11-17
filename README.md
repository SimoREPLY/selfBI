# self-BI

Un agente AI che risponde a domande in linguaggio naturale su un database.
Scrivi "fatturato mensile 2025": l'agente legge lo schema, scrive ed esegue la query SQL, ti mostra il **risultato in tabella** e, quando ha senso, anche un **grafico**, con un breve commento sui numeri.

| Parte | Tecnologia |
|---|---|
| LLM | Amazon Bedrock (default: Anthropic Claude Haiku 5.5, region `eu-north-1`), autenticazione con **Bedrock API key** |
| Agente | LangChain 1.x (`create_agent`, che gira su LangGraph) + `langchain-aws` (`ChatBedrockConverse`) |
| Backend | Python, FastAPI, SQLAlchemy |
| Frontend | React 19, TypeScript, Vite, Recharts |
| DB | Qualsiasi DB supportato da SQLAlchemy. Senza configurazione usa un DB SQLite demo |

---

## Indice

1. [Avvio rapido](#1-avvio-rapido)
2. [Come funziona: la visione d'insieme](#2-come-funziona-la-visione-dinsieme)
3. [Architettura](#3-architettura)
4. [Il ciclo di vita di una domanda, passo per passo](#4-il-ciclo-di-vita-di-una-domanda-passo-per-passo)
5. [Backend in dettaglio](#5-backend-in-dettaglio)
6. [Frontend in dettaglio](#6-frontend-in-dettaglio)
7. [Contratto API](#7-contratto-api)
8. [Sicurezza e dati](#8-sicurezza-e-dati)
9. [Configurazione](#9-configurazione)
10. [Usare il proprio database](#10-usare-il-proprio-database)
11. [Test](#11-test)
12. [Troubleshooting](#12-troubleshooting)
13. [Limiti noti ed estensioni possibili](#13-limiti-noti-ed-estensioni-possibili)

---

## 1. Avvio rapido

Requisiti: [uv](https://docs.astral.sh/uv/) (gestisce Python e le dipendenze) e Node 20+.

**Backend** (terminale 1):

```powershell
cd backend
Copy-Item .env.example .env      # solo la prima volta
# apri .env e incolla la Bedrock API key in AWS_BEARER_TOKEN_BEDROCK
uv sync                          # solo la prima volta
uv run uvicorn main:app --port 8642 --reload
```

**Frontend** (terminale 2):

```powershell
cd frontend
npm install                      # solo la prima volta
npm run dev
```

Apri l'URL stampato da Vite (di solito `http://localhost:5173`; se la porta è occupata Vite usa la successiva, es. `5174`).

> ⚠️ Il backend legge `.env` **solo all'avvio**. Se cambi la key o un'altra variabile, riavvia il backend: `--reload` reagisce solo alle modifiche dei file `.py`.

---

## 2. Come funziona: la visione d'insieme

Pensa all'agente come a un **analista junior con accesso in sola lettura al database**:

1. **Riceve la domanda** ("quali sono i 10 clienti che fatturano di più?").
2. **Guarda come è fatto il database**: conosce già i nomi delle tabelle, chiede le colonne di quelle che gli servono e ne vede qualche riga di esempio.
3. **Scrive una query SQL** e la esegue.
4. **Se la query sbaglia** (colonna inesistente, sintassi errata) legge l'errore, la corregge e riprova.
5. **Guarda un'anteprima del risultato** e decide se un grafico aiuta: andamento nel tempo → linee, confronto tra categorie → barre, composizione di un totale → torta, relazione tra due numeri → dispersione.
6. **Risponde in 2-4 frasi** con il dato chiave.

L'utente vede quattro cose: **la risposta testuale**, **il grafico** (se c'è), **la tabella completa** e **la query SQL** usata, così ogni numero è verificabile.

Due principi guidano il progetto:

- **Il modello decide, il codice controlla.** L'LLM sceglie quali query fare e che grafico disegnare, ma tutto ciò che conta lo garantisce il codice Python: che la query sia in sola lettura, che le colonne del grafico esistano, quante righe tornano, quanto tempo e quanti passi può usare.
- **I dati veri non passano dal modello.** La tabella che vedi arriva direttamente dal database al browser. Il modello vede solo un'anteprima di 20 righe, quanto basta per ragionare e commentare. Così il risultato è esatto (nessun numero "riscritto" dall'LLM) e si risparmiano token.

---

## 3. Architettura

```mermaid
flowchart LR
    U[Utente] -->|domanda| FE["Frontend React<br/>(Vite, Recharts)"]
    FE -->|"POST /api/query<br/>(proxy Vite)"| API["FastAPI<br/>main.py"]
    API --> AG["Agente LangChain<br/>agent.py"]
    AG <-->|"Converse API<br/>Bearer API key"| BR["Amazon Bedrock<br/>Claude Haiku 5.5"]
    AG -->|tool calls| T["Tools<br/>describe_tables · run_sql · make_chart"]
    T --> DB["db.py<br/>guard SQL + SQLAlchemy"]
    DB --> D[("Database<br/>(SQLite demo o il tuo)")]
    API -->|"JSON: answer, sql,<br/>columns, rows, chart"| FE
```

Se il diagramma non viene renderizzato, eccolo in testo:

```
Browser (React) ──POST /api/query──► FastAPI (main.py)
                                        │
                                        ▼
                                Agente LangChain (agent.py) ◄──► Amazon Bedrock (LLM)
                                        │  tool calls
                                        ▼
                         describe_tables / run_sql / make_chart
                                        │
                                        ▼
                         db.py (guard read-only + SQLAlchemy) ──► Database
```

### Struttura del repository

```
self-BI/
├── backend/
│   ├── main.py          # FastAPI: endpoint HTTP, validazione input, mappatura errori
│   ├── agent.py         # Agente LangChain: modello Bedrock, prompt, tool, limiti
│   ├── db.py            # Accesso DB: engine, guard read-only, schema, seed demo
│   ├── test_db.py       # Test del layer DB e del guard
│   ├── pyproject.toml   # Dipendenze Python (gestite con uv)
│   ├── .env.example     # Modello di configurazione (MAI metterci segreti)
│   └── .env             # Configurazione reale con la key (ignorato da git)
├── frontend/
│   ├── vite.config.ts   # Proxy /api → backend
│   └── src/
│       ├── App.tsx      # Pagina: domanda, cronologia sessione, risposta, tabella, SQL
│       ├── Chart.tsx    # Rendering del grafico da una "chart spec" (caricato al bisogno)
│       └── index.css    # Layout, token colore, tema chiaro/scuro, palette grafici
└── README.md
```

---

## 4. Il ciclo di vita di una domanda, passo per passo

Esempio reale con la domanda **"Ordini per stato"**. Questi sono i log del backend:

```
[0f83f2c9] describe_tables ['orders']
[0f83f2c9] run_sql SELECT status AS stato, COUNT(*) AS numero_ordini FROM orders GROUP BY status ORDER BY numero_ordini DESC, stato
[0f83f2c9] done steps=4 in_tokens=2434 out_tokens=169
```

Cosa succede, in ordine:

```mermaid
sequenceDiagram
    participant B as Browser
    participant F as FastAPI
    participant A as Agente
    participant L as Bedrock (LLM)
    participant D as Database

    B->>F: POST /api/query {"question": "Ordini per stato"}
    F->>A: ask(question)
    A->>L: system prompt (con nomi tabelle) + domanda + definizione tool
    L-->>A: tool call describe_tables(["orders"])
    A->>D: colonne, FK, 3 righe di esempio
    A->>L: risultato del tool
    L-->>A: tool call run_sql("SELECT status AS stato, COUNT(*) ...")
    A->>D: query (dopo il controllo read-only)
    D-->>A: righe
    Note over A: salva il risultato completo nello stato della richiesta
    A->>L: colonne + anteprima (max 20 righe)
    L-->>A: tool call make_chart(bar, x="stato", y=["numero_ordini"])
    Note over A: verifica che le colonne esistano
    A->>L: "chart ok"
    L-->>A: risposta finale testuale
    A-->>F: {answer, sql, columns, rows, chart}
    F-->>B: JSON
    Note over B: mostra risposta, grafico, tabella, SQL
```

1. **Browser → backend.** Il frontend chiama `POST /api/query`. In sviluppo Vite inoltra `/api/*` al backend su `127.0.0.1:8642`, quindi niente CORS.
2. **Validazione.** FastAPI/Pydantic controllano che la domanda sia lunga tra 1 e 2000 caratteri.
3. **Costruzione dell'agente.** Per ogni richiesta `agent.ask()` crea un agente nuovo, con i suoi tool e uno **stato privato** (`result`, `sql`, `chart`). Il system prompt include il dialetto SQL e l'elenco delle tabelle, letti dal DB in quel momento.
4. **Loop ragiona → agisce.** Il modello alterna chiamate ai tool e ragionamento finché non produce una risposta finale. LangGraph esegue il loop: nodo *model* → nodo *tools* → nodo *model* → …
5. **Esecuzione SQL.** `run_sql` passa dal guard read-only, esegue la query, salva il risultato completo nello stato e al modello restituisce **solo** colonne, numero di righe e prime 20 righe.
6. **Grafico.** `make_chart` non disegna niente: registra una **specifica** (`type`, `x`, `y`, `title`) dopo aver verificato che le colonne esistano nell'ultimo risultato.
7. **Risposta.** Il backend restituisce il testo finale del modello più l'**ultimo risultato riuscito** di `run_sql` e l'eventuale chart spec.
8. **Rendering.** Il browser disegna grafico e tabella partendo dai dati veri.

---

## 5. Backend in dettaglio

### 5.1 `main.py`: il livello HTTP

- Carica `.env` (`python-dotenv`) **prima** di importare gli altri moduli, perché questi leggono le variabili d'ambiente all'import.
- Espone **un solo endpoint**: `POST /api/query`.
- Traduce gli errori dell'agente in codici HTTP chiari (vedi [Contratto API](#7-contratto-api)).
- Configura il logging (timestamp, livello, modulo).

### 5.2 `agent.py`: l'agente

**Il modello.** `ChatBedrockConverse` di `langchain-aws` usa la [Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) di Bedrock, un'interfaccia unica per tutti i modelli (OpenAI, Anthropic, Amazon, …). Per cambiare modello basta quindi cambiare `BEDROCK_MODEL_ID`, senza toccare il codice. Viene creato una sola volta, all'avvio del processo.

**Autenticazione.** `langchain-aws` legge `AWS_BEARER_TOKEN_BEDROCK` dall'ambiente e chiama Bedrock con `Authorization: Bearer <key>` invece della firma SigV4 classica: non servono access key IAM.

**L'agente.** `create_agent(llm, tools, system_prompt=...)` di LangChain 1.x costruisce un grafo LangGraph con due nodi (modello e tool) che si alternano finché il modello non risponde senza chiamare tool.

**I tool.** Sono tre, definiti con `@tool`. Docstring e type hint diventano lo schema JSON che il modello vede:

| Tool | Input | Cosa fa | Cosa vede il modello |
|---|---|---|---|
| `describe_tables` | `tables: list[str]` | Per ogni tabella: colonne con tipo, foreign key, 3 righe di esempio | Il testo descrittivo. Per un nome sconosciuto, l'elenco delle tabelle valide |
| `run_sql` | `sql: str` | Guard read-only → esecuzione → salva il risultato completo nello stato | `columns`, `row_count`, `truncated` e `preview` (max 20 righe). In caso di errore `{"error": "..."}`, così il modello si corregge |
| `make_chart` | `chart_type`, `x`, `y: list[str]`, `title` | Valida le colonne sull'ultimo risultato e salva la chart spec | `"chart ok"` oppure un errore con le colonne disponibili |

`chart_type` è un `Literal["bar","line","pie","scatter"]`: il modello non può inventare tipi diversi. Per la torta si tiene solo la prima colonna `y`.

**Lo stato per richiesta.** I tool sono definiti *dentro* `ask()` e condividono un dizionario `state` tramite closure. Ogni richiesta ha quindi il suo stato e due utenti contemporanei non si mescolano. Ogni nuovo `run_sql` riuscito sostituisce il risultato precedente e azzera il grafico, così il grafico si riferisce sempre ai dati mostrati.

**Perché "l'ultima query riuscita".** L'agente può fare query esplorative o sbagliate prima di quella buona. Il prompt gli dice esplicitamente che l'utente vedrà il risultato dell'**ultima** `run_sql` riuscita, quindi la query finale deve essere quella che risponde alla domanda.

**Il system prompt** dice all'agente come lavorare (descrivere le tabelle → una sola SELECT → eventuale grafico → risposta breve nella lingua dell'utente), quando un grafico ha senso e quando no, di non inventare se i dati non bastano, e che il contenuto restituito dai tool è *dato* e non *istruzione* (difesa base contro prompt injection presente nei dati).

**Limiti per richiesta** (le hard rule di ogni agente):

| Limite | Default | Come è implementato |
|---|---|---|
| Passi massimi | 15 chiamate al modello | `recursion_limit = 15 × 2 + 1 = 31` passi del grafo LangGraph (ogni passo = nodo modello + nodo tool). Superato → `GraphRecursionError` → HTTP 422 |
| Tempo massimo | 90 s | `asyncio.wait_for(...)` attorno all'intera esecuzione → HTTP 504 |
| Righe all'utente | 1000 | `fetchmany(MAX_ROWS + 1)`: la riga in più serve solo a sapere se c'è stato troncamento |
| Righe al modello | 20 | `PREVIEW_ROWS` |
| Token in output per chiamata | 16000 | `max_tokens` del modello |

**Logging.** Ogni richiesta ha un ID di 8 caratteri. Si loggano ogni tool call (con l'SQL) e, alla fine, passi e token totali in input/output, sommati dagli `usage_metadata` dei messaggi.

### 5.3 `db.py`: accesso al database

**Engine.** Se `DATABASE_URL` è impostato si usa quello (qualsiasi URL SQLAlchemy). Altrimenti, al primo avvio, viene creato `backend/demo.db`, che viene sempre aperto in **sola lettura** (`file:...?mode=ro`, URI SQLite).

**Guard read-only (`check_sql`).** Prima di ogni esecuzione:

1. rimuove un eventuale `;` finale e rifiuta query con altri `;` (una sola istruzione);
2. richiede che la query inizi con `SELECT` o `WITH`;
3. rifiuta parole chiave di scrittura o amministrazione, anche annidate (es. `WITH x AS (DELETE ...)`): `insert, update, delete, drop, alter, create, truncate, grant, revoke, merge, attach, detach, pragma, vacuum, copy, exec, execute, call, into`.

Il controllo lavora per parole intere: colonne come `created_at` o `updated` e funzioni come `REPLACE()` passano. Essendo un'espressione regolare e non un parser SQL può avere falsi positivi (es. la parola `delete` dentro una stringa). In quel caso il modello riceve l'errore e riformula.

**Esecuzione.** La query gira in una connessione che non viene mai committata: all'uscita si fa rollback.

**Introspezione.** `table_names()` restituisce tabelle e viste; `describe()` restituisce colonne, foreign key e 3 righe di esempio tramite `sqlalchemy.inspect`, quindi funziona con qualunque DB.

**DB demo.** È generato in modo deterministico (seed fisso), così i risultati sono riproducibili:

| Tabella | Contenuto |
|---|---|
| `customers` | 200 clienti: `name`, `city`, `region` (Nord/Centro/Sud), `segment` (Retail/PMI/Enterprise) |
| `products` | 40 prodotti: `name`, `category` (Elettronica/Ufficio/Arredamento/Software), `unit_price` |
| `orders` | 3000 ordini 2024-2025: `customer_id`, `order_date` (testo ISO), `status` (completato/spedito/annullato) |
| `order_items` | Righe d'ordine: `order_id`, `product_id`, `quantity`, `unit_price` |

Per rigenerarlo basta cancellare `backend/demo.db` e riavviare il backend.

---

## 6. Frontend in dettaglio

È una single page divisa in due colonne:

- a sinistra il **rail** scuro, dove si chiede: campo domanda e cronologia della sessione;
- a destra lo **stage** chiaro, dove arrivano i dati: domanda in grande, risposta, grafico, tabella, SQL.

**`App.tsx`**
- **Domanda**: `Invio` invia, `Shift+Invio` va a capo. Il campo si svuota all'invio.
- **Cronologia della sessione**: ogni domanda finisce nell'elenco a sinistra con il suo risultato (o errore). Cliccandola la si riapre **senza rifare la query** né richiamare il modello. La cronologia vive solo in memoria: si perde ricaricando la pagina e non viene inviata all'agente come contesto (vedi [Limiti noti](#13-limiti-noti-ed-estensioni-possibili)).
- **Stato iniziale**: titolo, spiegazione e domande d'esempio cliccabili sul DB demo.
- **Caricamento**: una barra animata in alto e un messaggio per screen reader (`aria-live`). In caso di errore appare il `detail` del backend con un pulsante **Riprova**.
- **Risultato**, nell'ordine: **risposta** (il `**grassetto**` del modello viene reso come grassetto) → **grafico** → **tabella** → **SQL** (in "Mostra la query SQL", espandibile).
- **Tabella**: header fisso, scroll interno, numeri formattati in italiano (`1.234,56`) e allineati a destra, conteggio righe e avviso "risultato troncato" se si supera `MAX_ROWS`.
- **Caricamento pigro del grafico**: Recharts è la dipendenza più pesante, quindi `Chart.tsx` viene caricato con `React.lazy` solo quando serve. Il download parte già quando l'utente mette il cursore nel campo domanda, così quando arriva la risposta il codice del grafico è di solito già pronto.

**`Chart.tsx`** trasforma la chart spec del backend in un grafico Recharts:
- converte le righe (array) in oggetti `{colonna: valore}` e forza a numero le colonne `y`. Un valore mancante resta un **buco** nella linea, non diventa zero;
- **bar**: barre sottili con angoli arrotondati; **line**: linee da 2px, con i punti solo se ci sono ≤ 40 valori; **scatter**: assi numerici; **pie**: ad anello, fette ordinate per valore, oltre 8 le restanti confluiscono in "Altro";
- assi con numeri compatti (`1,2 Mln`), tooltip con valori completi, legenda solo con più serie (con una sola serie la nomina già il titolo) e sempre per la torta;
- al massimo 8 serie: i colori non vengono mai riciclati, le serie in più restano solo in tabella.

**`index.css`** definisce i token di colore come variabili CSS. Tema chiaro e scuro seguono `prefers-color-scheme` del sistema, senza JavaScript. La palette dei grafici (`--series-1` … `--series-8`) ha un ordine fisso ed è validata per la distinguibilità anche con daltonismo, con tonalità dedicate per sfondo chiaro e scuro. Il font è **Archivo**, caricato da Google Fonts (`index.html`).

**`vite.config.ts`**: il proxy `'/api' → http://127.0.0.1:8642` fa sì che browser e API stiano sulla stessa origine in sviluppo.

**Build di produzione**: `npm run build` genera `frontend/dist/`, file statici. Vanno serviti da un web server/reverse proxy che inoltri `/api` al backend (non incluso nel progetto).

---

## 7. Contratto API

### `POST /api/query`

Richiesta:

```json
{ "question": "Ordini per stato" }
```

Risposta `200`:

```json
{
  "answer": "Gli ordini completati sono 2.516, quelli spediti 330 e quelli annullati 154. In totale risultano 3.000 ordini.",
  "sql": "SELECT status AS stato, COUNT(*) AS numero_ordini FROM orders GROUP BY status ORDER BY numero_ordini DESC, stato",
  "columns": ["stato", "numero_ordini"],
  "rows": [["completato", 2516], ["spedito", 330], ["annullato", 154]],
  "truncated": false,
  "chart": { "type": "bar", "x": "stato", "y": ["numero_ordini"], "title": "Ordini per stato" }
}
```

- `sql`, `columns`, `rows` sono vuoti/`null` se l'agente non ha eseguito query (es. domanda non pertinente).
- `chart` è `null` se l'agente non ha ritenuto utile un grafico.

Errori (sempre `{"detail": "..."}`):

| Codice | Quando |
|---|---|
| `422` | Domanda vuota o > 2000 caratteri, oppure l'agente ha superato il numero massimo di passi |
| `504` | L'agente ha superato `AGENT_TIMEOUT_S` |
| `500` | Altro errore (es. key Bedrock non valida/scaduta, modello non abilitato). Il messaggio include la causa |

La documentazione interattiva (Swagger) è su `http://127.0.0.1:8642/docs`.

---

## 8. Sicurezza e dati

**Difese a strati contro le scritture sul DB:**

1. **Utente DB in sola lettura**: è il **vero confine di sicurezza** e va sempre configurato su `DATABASE_URL`. Il modello *non* è un confine di sicurezza.
2. **Guard `check_sql`**: blocca a livello applicativo tutto ciò che non è una singola lettura.
3. **Nessun commit**: ogni connessione fa rollback.
4. **DB demo aperto `mode=ro`**: SQLite rifiuta le scritture anche se il guard venisse aggirato (c'è un test apposta).

**Quali dati escono verso Bedrock:**
- domanda, nomi delle tabelle, colonne, **3 righe di esempio** per ogni tabella descritta, **le prime 20 righe** di ogni risultato e i messaggi d'errore SQL;
- con il profilo `global.anthropic.claude-haiku-5-5` l'elaborazione può avvenire **anche fuori dall'UE**. Se i dati sono sensibili, valuta un profilo regionale (se disponibile) e limita quali tabelle/viste l'utente DB può vedere.

**Segreti:**
- la key va **solo** in `backend/.env`, che `.gitignore` esclude. **Mai** in `.env.example`, che viene committato;
- la key non entra mai nel prompt.

**API senza autenticazione:** il backend è pensato per uso locale/interno. Prima di esporlo in rete va messo dietro autenticazione.

---

## 9. Configurazione

Tutte le variabili stanno in `backend/.env`:

| Variabile | Default | Descrizione |
|---|---|---|
| `AWS_BEARER_TOKEN_BEDROCK` | — | **Bedrock API key** (console Bedrock → API keys). Obbligatoria |
| `AWS_REGION` | `eu-north-1` | Region Bedrock. Le key *short-term* sono legate alla region in cui sono state generate |
| `BEDROCK_MODEL_ID` | `global.anthropic.claude-haiku-5-5` | ID del modello o dell'inference profile. Se la console indica un profilo (`global.`), usa quello invece dell'ID base |
| `DATABASE_URL` | vuoto → DB demo | URL SQLAlchemy |
| `MAX_ROWS` | `1000` | Righe massime restituite all'interfaccia |
| `AGENT_MAX_STEPS` | `15` | Chiamate massime al modello per domanda |
| `AGENT_TIMEOUT_S` | `90` | Secondi massimi per domanda |

**Tipi di Bedrock API key:**
- **short-term** (iniziano con `bedrock-api-key-`): durano fino a 12 ore, al massimo quanto la sessione che le ha generate, e valgono solo nella region di generazione. Comode per provare;
- **long-term**: durata configurabile, legate a un utente IAM. Adatte a un uso continuativo.

---

## 10. Usare il proprio database

1. Crea un **utente in sola lettura** con accesso solo alle tabelle/viste utili.
2. Installa il driver nel backend, ad esempio:
   ```powershell
   cd backend
   uv add "psycopg[binary]"       # PostgreSQL
   # uv add pymysql               # MySQL / MariaDB
   # uv add pyodbc                # SQL Server
   ```
3. Imposta l'URL in `.env`, ad esempio:
   ```
   DATABASE_URL=postgresql+psycopg://readonly:password@host:5432/nome_db
   ```
4. Riavvia il backend.

Suggerimenti per risultati migliori:
- **Nomi chiari** per tabelle e colonne aiutano molto il modello. Dove non lo sono, crea **viste** con nomi parlanti (es. `v_vendite_mensili`) e dai all'utente accesso solo a quelle.
- Con molte tabelle, l'elenco nel prompt cresce: anche qui conviene esporre un sottoinsieme tramite viste.
- Il guard non impone un timeout alle query: impostalo sull'utente DB (es. PostgreSQL `ALTER ROLE readonly SET statement_timeout = '15s'`).

---

## 11. Test

```powershell
cd backend
uv run pytest -q
```

I test coprono il guard SQL (scritture, query multiple, CTE con `DELETE`, `SELECT INTO`, `PRAGMA` rifiutati; nomi simili a parole chiave accettati), l'esecuzione sul DB demo, il troncamento, l'introspezione e la protezione read-only di SQLite anche aggirando il guard. Non chiamano Bedrock.

---

## 12. Troubleshooting

| Sintomo | Causa probabile | Soluzione |
|---|---|---|
| `IncompleteSignatureException ... Authorization header requires 'Credential' parameter` | Il backend è partito con la key **vuota** (es. `.env` modificato dopo l'avvio) | Controlla `AWS_BEARER_TOKEN_BEDROCK` in `backend/.env` e **riavvia** il backend |
| `ExpiredTokenException` / errori di autorizzazione dopo qualche ora | Key short-term scaduta | Genera una nuova key (o una long-term) e riavvia |
| `ValidationException` sul model ID / "on-demand throughput isn't supported" | ID base usato al posto dell'inference profile, o modello non abilitato nell'account | Usa l'ID del profilo indicato in console (es. `global.anthropic.claude-haiku-5-5`) e abilita l'accesso al modello |
| Il frontend mostra `HTTP 500`/`502` senza dettagli | Backend spento o su un'altra porta | Avvia il backend su `8642` o aggiorna il proxy in `vite.config.ts` |
| `error while attempting to bind on address` | Porta già usata | Avvia uvicorn su un'altra porta e aggiorna `vite.config.ts` |
| "L'agente ha superato il numero massimo di passi" | Domanda ambigua o schema difficile, il modello continua a riprovare | Riformula la domanda in modo più specifico, oppure alza `AGENT_MAX_STEPS` |
| Il grafico non compare | L'agente ha ritenuto i dati non adatti (es. un singolo valore) | Chiedi esplicitamente "fammi un grafico a barre di ..." |

I log del backend mostrano, per ogni richiesta, i tool chiamati con il loro SQL: sono il primo posto dove guardare.

---

## 13. Limiti noti ed estensioni possibili

Il progetto è volutamente minimale. Cose **non** implementate, da aggiungere quando servono:

- **Domande di follow-up** ("e ora dividilo per regione"): ogni domanda è indipendente. La cronologia a sinistra serve solo a riaprire i risultati. Per i follow-up bisognerebbe inviare all'agente le domande precedenti (e le relative SQL).
- **Cronologia persistente**: oggi si perde ricaricando la pagina.
- **Streaming** della risposta: oggi la UI attende la risposta completa (tipicamente pochi secondi).
- **Export CSV/Excel** della tabella.
- **Tetto di costo in token per richiesta**: oggi il costo è limitato indirettamente da passi massimi e timeout. I token usati sono comunque loggati.
- **Autenticazione** dell'API e **rate limiting**.
- **Guard SQL basato su parser** (es. `sqlglot`) al posto della regex, se i falsi positivi diventano un problema.
- **Eval set**: una raccolta di domande con risposta attesa da rieseguire a ogni modifica del prompt o dei tool.
