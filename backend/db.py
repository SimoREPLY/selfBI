"""DB access: engine, read-only guard, schema introspection, demo seed."""
import os
import random
import re
import sqlite3
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

MAX_ROWS = int(os.getenv("MAX_ROWS", "1000"))
DEMO_PATH = Path(__file__).with_name("demo.db")

# ponytail: regex guard, not a SQL parser. Real boundary = read-only DB user
# (and mode=ro for the demo). Swap for sqlglot if false positives bite.
_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|"
    r"attach|detach|pragma|vacuum|copy|exec|execute|call|into)\b",
    re.I,
)


def check_sql(sql: str) -> str:
    s = sql.strip().rstrip(";").strip()
    if ";" in s:
        raise ValueError("Only one statement allowed.")
    if not re.match(r"(?is)^(select|with)\b", s):
        raise ValueError("Only SELECT / WITH queries are allowed.")
    if m := _FORBIDDEN.search(s):
        raise ValueError(f"Forbidden keyword: {m.group(0)}")
    return s


def seed_demo(path: Path) -> None:
    rnd = random.Random(42)
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, city TEXT, region TEXT, segment TEXT);
        CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, category TEXT, unit_price REAL);
        CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id),
                             order_date TEXT, status TEXT);
        CREATE TABLE order_items (order_id INTEGER REFERENCES orders(id), product_id INTEGER REFERENCES products(id),
                                  quantity INTEGER, unit_price REAL);
    """)
    cities = [("Milano", "Nord"), ("Torino", "Nord"), ("Bologna", "Nord"), ("Roma", "Centro"),
              ("Firenze", "Centro"), ("Napoli", "Sud"), ("Bari", "Sud"), ("Palermo", "Sud")]
    segments = ["Retail", "PMI", "Enterprise"]
    con.executemany("INSERT INTO customers VALUES (?,?,?,?,?)", [
        (i, f"Cliente {i:03d}", *rnd.choice(cities), rnd.choice(segments)) for i in range(1, 201)])
    catalog = {"Elettronica": (80, 1500), "Ufficio": (5, 120), "Arredamento": (60, 900), "Software": (30, 600)}
    products = []
    for i in range(1, 41):
        cat = rnd.choice(list(catalog))
        products.append((i, f"{cat} #{i}", cat, round(rnd.uniform(*catalog[cat]), 2)))
    con.executemany("INSERT INTO products VALUES (?,?,?,?)", products)
    start = date(2024, 1, 1)
    orders, items = [], []
    for oid in range(1, 3001):
        d = start + timedelta(days=rnd.randrange(730))
        orders.append((oid, rnd.randint(1, 200), d.isoformat(),
                       rnd.choices(["completato", "spedito", "annullato"], [85, 10, 5])[0]))
        for p in rnd.sample(products, rnd.randint(1, 4)):
            items.append((oid, p[0], rnd.randint(1, 10), p[3]))
    con.executemany("INSERT INTO orders VALUES (?,?,?,?)", orders)
    con.executemany("INSERT INTO order_items VALUES (?,?,?,?)", items)
    con.commit()
    con.close()


def _make_engine():
    if url := os.getenv("DATABASE_URL"):
        return create_engine(url, pool_pre_ping=True)
    if not DEMO_PATH.exists():
        seed_demo(DEMO_PATH)
    uri = f"{DEMO_PATH.as_uri()}?mode=ro"
    return create_engine("sqlite://", creator=lambda: sqlite3.connect(uri, uri=True, check_same_thread=False))


engine = _make_engine()


def table_names() -> list[str]:
    insp = inspect(engine)
    return insp.get_table_names() + insp.get_view_names()


def describe(tables: list[str]) -> str:
    insp = inspect(engine)
    known = set(table_names())
    out = []
    for t in tables:
        if t not in known:
            out.append(f"{t}: unknown table. Available: {', '.join(sorted(known))}")
            continue
        cols = ", ".join(f"{c['name']} {c['type']}" for c in insp.get_columns(t))
        fks = "; ".join(f"{fk['constrained_columns']} -> {fk['referred_table']}{fk['referred_columns']}"
                        for fk in insp.get_foreign_keys(t))
        sample = run_sql(f'SELECT * FROM "{t}"', max_rows=3)["rows"]
        out.append(f"{t}({cols})" + (f"\n  FK: {fks}" if fks else "") + f"\n  sample: {sample}")
    return "\n".join(out)


def run_sql(sql: str, max_rows: int = MAX_ROWS) -> dict:
    sql = check_sql(sql)
    # ponytail: no statement timeout; set one on the DB user/role if queries can be heavy.
    with engine.connect() as conn:  # never committed -> rolled back on exit
        res = conn.execute(text(sql))
        columns = list(res.keys())
        rows = [list(r) for r in res.fetchmany(max_rows + 1)]
    return {"columns": columns, "rows": rows[:max_rows], "truncated": len(rows) > max_rows}
