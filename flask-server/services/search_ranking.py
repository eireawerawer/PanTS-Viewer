"""Deterministic quality ranking and demographic diversification for case search."""

from __future__ import annotations

from collections import Counter

import pandas as pd


QUALITY_COLUMNS = (
    ("__tumor01", False),
    ("__voxel_count", False),
    ("__spacing_volume", True),
    ("__shape_sum", False),
    ("__spacing_sum", True),
    ("__case_sortkey", True),
)


def _bucket(value: object, unknown: str) -> object:
    if value is None or pd.isna(value) or str(value).strip() == "":
        return unknown
    return value


def _age_bucket(value: object) -> object:
    if value is None or pd.isna(value):
        return "UNKNOWN"
    try:
        age = max(0, int(float(value)))
    except (TypeError, ValueError):
        return "UNKNOWN"
    return f"{min(age // 10, 9) * 10:02d}s"


def _diversify_block(
    block: pd.DataFrame,
    *,
    balance_sex: bool,
    balance_age: bool,
) -> pd.DataFrame:
    """Greedily alternate demographics while retaining quality as the tie-breaker."""
    if len(block) < 2 or not (balance_sex or balance_age):
        return block

    remaining = list(range(len(block)))
    selected: list[int] = []
    sex_counts: Counter[object] = Counter()
    age_counts: Counter[object] = Counter()

    sex_values = [
        _bucket(value, "UNKNOWN")
        for value in block.get("__sex", pd.Series(index=block.index, dtype=object))
    ]
    age_values = [
        _age_bucket(value)
        for value in block.get("__age", pd.Series(index=block.index, dtype=object))
    ]

    while remaining:
        def diversity_score(position: int) -> tuple[int, int, int]:
            penalties = []
            if balance_sex:
                penalties.append(sex_counts[sex_values[position]])
            if balance_age:
                penalties.append(age_counts[age_values[position]])
            return (sum(penalties), max(penalties, default=0), position)

        position = min(remaining, key=diversity_score)
        remaining.remove(position)
        selected.append(position)
        if balance_sex:
            sex_counts[sex_values[position]] += 1
        if balance_age:
            age_counts[age_values[position]] += 1

    return block.iloc[selected]


def rank_quality_results(
    df: pd.DataFrame,
    *,
    balance_sex: bool = True,
    balance_age: bool = True,
    diversity_window: int = 96,
) -> pd.DataFrame:
    """Rank tumors and high-resolution scans first, then diversify nearby results.

    Diversification is constrained to fixed-size quality windows and never crosses
    tumor tiers. That keeps the ranking useful while preventing a first page made up
    of one sex or one narrow age band when those fields were not explicitly filtered.
    """
    if df.empty:
        return df

    available = [
        (column, ascending)
        for column, ascending in QUALITY_COLUMNS
        if column in df.columns
    ]
    if not available:
        return df
    columns = [column for column, _ in available]
    ascending = [direction for _, direction in available]
    ranked = df.sort_values(
        by=columns,
        ascending=ascending,
        na_position="last",
        kind="mergesort",
    )

    if not (balance_sex or balance_age):
        return ranked

    window = max(1, int(diversity_window))
    tiers = (
        ranked.groupby("__tumor01", sort=False, dropna=False)
        if "__tumor01" in ranked.columns
        else [(None, ranked)]
    )
    blocks: list[pd.DataFrame] = []
    for _, tier in tiers:
        for start in range(0, len(tier), window):
            blocks.append(
                _diversify_block(
                    tier.iloc[start : start + window],
                    balance_sex=balance_sex,
                    balance_age=balance_age,
                )
            )

    return pd.concat(blocks) if blocks else ranked
