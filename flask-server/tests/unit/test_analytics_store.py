"""Unit tests for the analytics store: what it accepts, what it refuses, and
whether the aggregates the dashboard reads are actually right.

Each test gets its own temp-file database, following test_plan_store's fixture.
"""

import importlib
from datetime import timedelta

import pytest

from models.job import utcnow


@pytest.fixture()
def store(tmp_path, monkeypatch):
    """Fresh temp DB; hands back (analytics_store, auth_store, user_id)."""
    db_path = tmp_path / "analytics.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")

    import constants
    importlib.reload(constants)
    import models.engine as engine
    importlib.reload(engine)
    import models.job  # noqa: F401
    import models.user  # noqa: F401
    import models.auth_session  # noqa: F401
    import models.usage_event  # noqa: F401
    import models.analytics_event  # noqa: F401
    import services.auth_store as auth_store
    importlib.reload(auth_store)
    import services.analytics_store as analytics_store
    importlib.reload(analytics_store)

    engine.reset_engine_for_tests()
    engine.create_all()
    user = auth_store.create_user("tracked@example.com", "correct-horse-battery")
    yield analytics_store, auth_store, user["id"]
    engine.reset_engine_for_tests()


def action(name, **extra):
    base = {"kind": "action", "name": name, "anon_id": "anon-1", "session_id": "sess-1"}
    base.update(extra)
    return base


def page(name, duration_ms, **extra):
    base = {
        "kind": "page_view", "name": name, "route": name,
        "duration_ms": duration_ms, "anon_id": "anon-1", "session_id": "sess-1",
    }
    base.update(extra)
    return base


def wide_range():
    now = utcnow()
    return now - timedelta(days=1), now + timedelta(days=1)


# ---- recording -------------------------------------------------------------

def test_records_a_batch_and_reports_how_many_landed(store):
    analytics_store, _, user_id = store
    stored = analytics_store.record_events(
        [action("upload_start_inference"), page("/upload", 5000)], user_id=user_id
    )
    assert stored == 2


def test_unknown_event_names_are_dropped_without_failing_the_batch(store):
    analytics_store, _, user_id = store
    stored = analytics_store.record_events([
        action("upload_start_inference"),
        action("something_someone_made_up"),
        {"kind": "action", "name": "viewer_open_case"},  # no anon/session id
    ], user_id=user_id)
    assert stored == 1


def test_a_route_outside_the_pattern_list_is_not_stored(store):
    """A raw URL carrying a case id must never become a row."""
    analytics_store, _, user_id = store
    assert analytics_store.record_events(
        [page("/case/BDMAP_00000123", 1000)], user_id=user_id
    ) == 0


def test_plan_and_type_are_taken_from_the_account_not_the_request(store):
    analytics_store, auth_store, user_id = store
    auth_store.update_account_type(user_id, "clinician")

    analytics_store.record_events(
        [action("viewer_open_case", plan="enterprise", account_type="patient")],
        user_id=user_id,
    )

    data = analytics_store.overview(*wide_range())
    assert data["by_plan"] == [{"plan": "free", "events": 1, "people": 1}]
    assert data["by_account_type"] == [
        {"account_type": "clinician", "events": 1, "people": 1}
    ]


def test_anonymous_events_are_stored_with_no_account(store):
    analytics_store, _, _ = store
    assert analytics_store.record_events([action("auth_open_modal")], user_id=None) == 1

    data = analytics_store.overview(*wide_range())
    assert data["totals"]["people"] == 1
    assert data["totals"]["signed_in_people"] == 0
    assert data["by_plan"] == [{"plan": "anonymous", "events": 1, "people": 1}]


def test_a_signed_in_user_without_a_type_is_not_counted_as_anonymous(store):
    analytics_store, _, user_id = store
    analytics_store.record_events([action("viewer_open_case")], user_id=user_id)
    analytics_store.record_events(
        [action("auth_open_modal", anon_id="anon-2", session_id="sess-2")], user_id=None
    )

    labels = {r["account_type"] for r in analytics_store.overview(*wide_range())["by_account_type"]}
    assert labels == {"not set", "anonymous"}


def test_a_future_timestamp_is_clamped_to_now(store):
    analytics_store, _, user_id = store
    year_3000 = 32503680000000
    analytics_store.record_events(
        [action("viewer_open_case", ts=year_3000)], user_id=user_id
    )
    # Still inside a range that ends tomorrow, so it was not stored in the future.
    assert analytics_store.overview(*wide_range())["totals"]["events"] == 1


def test_an_absurd_page_duration_is_clamped_rather_than_dropped(store):
    analytics_store, _, user_id = store
    a_week_ms = 7 * 24 * 60 * 60 * 1000
    analytics_store.record_events([page("/dashboard", a_week_ms)], user_id=user_id)

    route = analytics_store.overview(*wide_range())["time_by_route"][0]
    assert route["views"] == 1
    assert route["total_ms"] == analytics_store.MAX_DURATION_MS


def test_an_oversized_batch_is_truncated(store):
    analytics_store, _, user_id = store
    events = [action("viewer_open_case")] * (analytics_store.MAX_BATCH + 50)
    assert analytics_store.record_events(events, user_id=user_id) == analytics_store.MAX_BATCH


def test_empty_and_malformed_batches_are_a_no_op(store):
    analytics_store, _, user_id = store
    assert analytics_store.record_events([], user_id=user_id) == 0
    assert analytics_store.record_events(None, user_id=user_id) == 0
    assert analytics_store.record_events(["not a dict"], user_id=user_id) == 0


# ---- aggregates ------------------------------------------------------------

def test_top_actions_are_ordered_by_how_often_they_happened(store):
    analytics_store, _, user_id = store
    analytics_store.record_events(
        [action("viewer_open_case")] * 3 + [action("report_open")] * 5, user_id=user_id
    )

    top = analytics_store.overview(*wide_range())["top_actions"]
    assert [t["name"] for t in top] == ["report_open", "viewer_open_case"]
    assert top[0]["count"] == 5


def test_time_by_route_sums_and_averages_dwell_time(store):
    analytics_store, _, user_id = store
    analytics_store.record_events(
        [page("/dashboard", 1000), page("/dashboard", 3000), page("/upload", 500)],
        user_id=user_id,
    )

    data = analytics_store.overview(*wide_range())
    dashboard = next(r for r in data["time_by_route"] if r["route"] == "/dashboard")
    assert dashboard["views"] == 2
    assert dashboard["total_ms"] == 4000
    assert dashboard["avg_ms"] == 2000
    assert data["totals"]["time_ms"] == 4500


def test_filtering_by_plan_excludes_everyone_else(store):
    analytics_store, auth_store, user_id = store
    other = auth_store.create_user("pro@example.com", "correct-horse-battery")
    import services.plan_store as plan_store
    plan_store.set_plan(other["id"], "pro")

    analytics_store.record_events([action("viewer_open_case")], user_id=user_id)
    analytics_store.record_events(
        [action("report_open", anon_id="anon-2", session_id="sess-2")], user_id=other["id"]
    )

    start, end = wide_range()
    pro_only = analytics_store.overview(start, end, plan="pro")
    assert pro_only["totals"]["events"] == 1
    assert [t["name"] for t in pro_only["top_actions"]] == ["report_open"]


def test_filtering_by_account_type_excludes_everyone_else(store):
    analytics_store, auth_store, user_id = store
    auth_store.update_account_type(user_id, "researcher")
    other = auth_store.create_user("student@example.com", "correct-horse-battery")
    auth_store.update_account_type(other["id"], "student")

    analytics_store.record_events([action("viewer_open_case")], user_id=user_id)
    analytics_store.record_events(
        [action("report_open", anon_id="anon-2", session_id="sess-2")], user_id=other["id"]
    )

    start, end = wide_range()
    researchers = analytics_store.overview(start, end, account_type="researcher")
    assert [t["name"] for t in researchers["top_actions"]] == ["viewer_open_case"]


def test_audience_filter_splits_signed_in_from_anonymous(store):
    analytics_store, _, user_id = store
    analytics_store.record_events([action("viewer_open_case")], user_id=user_id)
    analytics_store.record_events(
        [action("auth_open_modal", anon_id="anon-2", session_id="sess-2")], user_id=None
    )

    start, end = wide_range()
    assert analytics_store.overview(
        start, end, audience=analytics_store.AUDIENCE_SIGNED_IN
    )["totals"]["events"] == 1
    assert analytics_store.overview(
        start, end, audience=analytics_store.AUDIENCE_ANONYMOUS
    )["totals"]["events"] == 1
    assert analytics_store.overview(start, end)["totals"]["events"] == 2


def test_events_outside_the_range_are_excluded(store):
    analytics_store, _, user_id = store
    analytics_store.record_events([action("viewer_open_case")], user_id=user_id)

    now = utcnow()
    long_ago = analytics_store.overview(now - timedelta(days=30), now - timedelta(days=20))
    assert long_ago["totals"]["events"] == 0
    assert long_ago["top_actions"] == []


def test_people_counts_distinct_browsers_not_events(store):
    analytics_store, _, user_id = store
    analytics_store.record_events([action("viewer_open_case")] * 4, user_id=user_id)
    analytics_store.record_events(
        [action("viewer_open_case", anon_id="anon-2", session_id="sess-2")], user_id=user_id
    )

    data = analytics_store.overview(*wide_range())
    assert data["totals"]["events"] == 5
    assert data["totals"]["people"] == 2
    assert data["top_actions"][0]["people"] == 2
