import pandas as pd

from services.search_ranking import rank_quality_results


def _frame(rows):
    return pd.DataFrame(rows).set_index("id", drop=False)


def _row(case_id, *, tumor, voxels, spacing, sex, age, order):
    return {
        "id": case_id,
        "__tumor01": tumor,
        "__voxel_count": voxels,
        "__spacing_volume": spacing,
        "__shape_sum": 50,
        "__spacing_sum": 2.0,
        "__case_sortkey": order,
        "__sex": sex,
        "__age": age,
    }


def test_quality_ranking_prioritizes_tumors_then_resolution():
    df = _frame([
        _row("low-res-tumor", tumor=1, voxels=100, spacing=1.0, sex="F", age=40, order=1),
        _row("high-res-no-tumor", tumor=0, voxels=1000, spacing=0.2, sex="F", age=40, order=2),
        _row("high-res-tumor", tumor=1, voxels=900, spacing=0.3, sex="F", age=40, order=3),
    ])

    ranked = rank_quality_results(df, balance_sex=False, balance_age=False)

    assert ranked["id"].tolist() == ["high-res-tumor", "low-res-tumor", "high-res-no-tumor"]


def test_quality_ranking_balances_unfiltered_sex_and_age_within_quality_window():
    df = _frame([
        _row("f40-1", tumor=1, voxels=1000, spacing=0.2, sex="F", age=44, order=1),
        _row("f40-2", tumor=1, voxels=990, spacing=0.2, sex="F", age=45, order=2),
        _row("m60", tumor=1, voxels=980, spacing=0.2, sex="M", age=66, order=3),
        _row("f20", tumor=1, voxels=970, spacing=0.2, sex="F", age=28, order=4),
    ])

    ranked = rank_quality_results(df)

    assert ranked["id"].tolist()[:3] == ["f40-1", "m60", "f20"]


def test_quality_ranking_does_not_mix_tumor_tiers_for_diversity():
    df = _frame([
        _row("tumor-f40", tumor=1, voxels=100, spacing=1.0, sex="F", age=40, order=1),
        _row("tumor-f41", tumor=1, voxels=90, spacing=1.0, sex="F", age=41, order=2),
        _row("no-tumor-m70", tumor=0, voxels=1000, spacing=0.1, sex="M", age=70, order=3),
    ])

    ranked = rank_quality_results(df)

    assert ranked["id"].tolist() == ["tumor-f40", "tumor-f41", "no-tumor-m70"]
