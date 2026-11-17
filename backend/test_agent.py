import pytest

from agent import fit_chart, is_time_axis


@pytest.mark.parametrize("name,values,expected", [
    ("anno", [2025, 2024, 2023], True),            # bare years + time-ish name
    ("mese", ["2025-01", "2025-02"], True),
    ("x", ["2025-01-31", "2025-02-28 00:00:00"], True),
    ("periodo", ["2025-Q1", "2025-Q2"], True),
    ("codice", [2024, 2025], False),               # 4-digit codes are not years without a time-ish name
    ("regione", ["Nord", "Sud"], False),
    ("anno", [2025], False),                        # a single point is not a timeline
])
def test_is_time_axis(name, values, expected):
    assert is_time_axis(name, values) is expected


def test_time_axis_becomes_ascending_line():
    res = {"columns": ["anno", "fatturato"], "rows": [["2025", 3.0], ["2024", 2.0], ["2023", 1.0]]}
    spec = fit_chart("bar", "anno", ["fatturato"], "Fatturato per anno", res)
    assert spec["type"] == "line"
    assert [r[0] for r in res["rows"]] == ["2023", "2024", "2025"]


def test_long_format_over_time_becomes_one_line_per_category():
    res = {"columns": ["anno", "regione", "fatturato"],
           "rows": [["2025", "Nord", 4], ["2024", "Nord", 2], ["2024", "Sud", 1], ["2025", "Sud", 3]]}
    spec = fit_chart("bar", "anno", ["fatturato"], "t", res)
    assert spec == {"type": "line", "x": "anno", "y": ["Nord", "Sud"], "title": "t"}
    assert res["columns"] == ["anno", "Nord", "Sud"]
    assert res["rows"] == [["2024", 2, 1], ["2025", 4, 3]]


def test_categories_keep_model_choice():
    res = {"columns": ["regione", "n"], "rows": [["Sud", 1], ["Nord", 2]]}
    assert fit_chart("bar", "regione", ["n"], "t", res)["type"] == "bar"
    assert fit_chart("pie", "regione", ["n", "m"], "t", res)["y"] == ["n"]
