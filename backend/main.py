from dotenv import load_dotenv

load_dotenv()  # before importing modules that read env

import logging  # noqa: E402

from fastapi import FastAPI, HTTPException  # noqa: E402
from langgraph.errors import GraphRecursionError  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

import agent  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
app = FastAPI(title="self-BI")


class Query(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


@app.post("/api/query")
async def query(q: Query):
    try:
        return await agent.ask(q.question)
    except TimeoutError:
        raise HTTPException(504, "L'agente ha superato il tempo massimo.")
    except GraphRecursionError:
        raise HTTPException(422, "L'agente ha superato il numero massimo di passi.")
    except Exception as e:
        logging.exception("agent failed")
        raise HTTPException(500, f"Errore agente: {type(e).__name__}: {e}")
