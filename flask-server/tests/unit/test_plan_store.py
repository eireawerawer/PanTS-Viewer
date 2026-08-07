"""Unit tests for plan limits: which models a plan may run, the rolling daily
quota, the concurrency slot, and the assistant allowance.

Each test gets its own temp-file database, following test_job_store's fixture.
"""

import importlib

import pytest


@pytest.fixture()
def plans(tmp_path, monkeypatch):
    """Fresh temp DB; hands back (plan_store, user_id) for a free-plan account."""
    db_path = tmp_path / "plans.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")

    import constants
    importlib.reload(constants)
    import models.engine as engine
    importlib.reload(engine)
    import models.job  # noqa: F401
    import models.user  # noqa: F401
    import models.auth_session  # noqa: F401
    import models.usage_event  # noqa: F401
    import services.auth_store as auth_store
    importlib.reload(auth_store)
    import services.plan_store as plan_store
    importlib.reload(plan_store)

    engine.reset_engine_for_tests()
    engine.create_all()
    user = auth_store.create_user("limits@example.com", "correct-horse-battery")
    yield plan_store, user["id"]
    engine.reset_engine_for_tests()


def test_new_accounts_start_on_free(plans):
    plan_store, user_id = plans
    assert plan_store.get_plan(user_id) == "free"


def test_free_may_only_run_the_free_model(plans):
    plan_store, user_id = plans
    assert plan_store.check_inference(user_id, "LesionSegmenter") is None

    blocked = plan_store.check_inference(user_id, "ePAI")
    assert blocked is not None
    assert blocked["reason"] == "model_locked"
    assert blocked["feature"] == "ePAI"


def test_upgrading_unlocks_every_model(plans):
    plan_store, user_id = plans
    plan_store.set_plan(user_id, "pro")
    assert plan_store.check_inference(user_id, "ePAI") is None


def test_unknown_plan_is_refused(plans):
    plan_store, user_id = plans
    with pytest.raises(ValueError):
        plan_store.set_plan(user_id, "platinum")


def test_daily_quota_blocks_the_fourth_scan(plans):
    plan_store, user_id = plans
    for i in range(3):
        assert plan_store.check_inference(user_id, "LesionSegmenter") is None
        plan_store.record_inference(user_id, f"session-{i}", "LesionSegmenter")
        plan_store.finish_inference(f"session-{i}")  # free the concurrency slot

    blocked = plan_store.check_inference(user_id, "LesionSegmenter")
    assert blocked is not None
    assert blocked["reason"] == "daily_scans"
    assert blocked["limit"] == 3
    assert blocked["used"] == 3
    assert blocked["resets_at"]


def test_concurrency_blocks_a_second_run_still_in_flight(plans):
    plan_store, user_id = plans
    plan_store.record_inference(user_id, "session-a", "LesionSegmenter")

    blocked = plan_store.check_inference(user_id, "LesionSegmenter")
    assert blocked is not None
    assert blocked["reason"] == "concurrent_scans"

    # Finishing the run frees the slot without refunding the quota.
    plan_store.finish_inference("session-a")
    assert plan_store.check_inference(user_id, "LesionSegmenter") is None
    assert plan_store.usage_summary(user_id)["scans"]["used"] == 1


def test_rerunning_a_session_id_does_not_charge_twice(plans):
    plan_store, user_id = plans
    plan_store.record_inference(user_id, "session-a", "LesionSegmenter")
    plan_store.finish_inference("session-a")
    plan_store.record_inference(user_id, "session-a", "LesionSegmenter")

    assert plan_store.usage_summary(user_id)["scans"]["used"] == 1


def test_postprocessing_is_gated_but_not_metered(plans):
    plan_store, user_id = plans
    blocked = plan_store.check_inference(user_id, "ShapeKit")
    assert blocked is not None
    assert blocked["reason"] == "postprocessing"

    plan_store.set_plan(user_id, "pro")
    assert plan_store.check_inference(user_id, "ShapeKit") is None
    plan_store.record_inference(user_id, "session-shape", "ShapeKit")
    assert plan_store.usage_summary(user_id)["scans"]["used"] == 0


def test_assistant_allowance(plans):
    plan_store, user_id = plans
    for _ in range(10):
        assert plan_store.check_ai_message(user_id) is None
        plan_store.record_ai_message(user_id)

    blocked = plan_store.check_ai_message(user_id)
    assert blocked is not None
    assert blocked["reason"] == "daily_ai_messages"
    assert blocked["limit"] == 10


def test_enterprise_is_unmetered(plans):
    plan_store, user_id = plans
    plan_store.set_plan(user_id, "enterprise")
    for i in range(60):
        plan_store.record_inference(user_id, f"session-{i}", "ePAI")
    assert plan_store.check_inference(user_id, "ePAI") is None
    assert plan_store.check_ai_message(user_id) is None


def test_usage_summary_reports_the_plan_limits(plans):
    plan_store, user_id = plans
    summary = plan_store.usage_summary(user_id)
    assert summary["plan"] == "free"
    assert summary["limits"]["daily_scans"] == 3
    assert summary["scans"] == {
        "used": 0, "limit": 3, "in_flight": 0, "resets_at": None
    }
