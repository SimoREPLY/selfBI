import pytest

import db


@pytest.mark.parametrize("sql", [
    "DELETE FROM orders",
    "SELECT 1; DROP TABLE orders",
    "WITH x AS (DELETE FROM orders RETURNING *) SELECT * FROM x",
    "SELECT * INTO backup FROM orders",
    "PRAGMA table_info(orders)",
    "UPDATE orders SET status='x'",
])
def test_guard_rejects_writes(sql):
    with pytest.raises(ValueError):
        db.check_sql(sql)


def test_guard_allows_reads_with_lookalike_names():
    db.check_sql("SELECT REPLACE(name,'a','b') AS created_at, 'x' AS updated FROM customers;")


def test_run_sql_on_demo():
    res = db.run_sql("SELECT region, COUNT(*) AS n FROM customers GROUP BY region ORDER BY region")
    assert res["columns"] == ["region", "n"]
    assert [r[0] for r in res["rows"]] == ["Centro", "Nord", "Sud"]


def test_demo_db_is_read_only_even_if_guard_bypassed():
    with db.engine.connect() as conn, pytest.raises(Exception, match="readonly"):
        conn.exec_driver_sql("DELETE FROM orders")


def test_describe_and_truncation():
    assert "customer_id" in db.describe(["orders"])
    assert db.run_sql("SELECT * FROM orders", max_rows=5)["truncated"] is True
