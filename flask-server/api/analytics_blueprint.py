"""Analytics: one write endpoint for the product, one read endpoint for the
internal dashboard.

Routes (registered under <BASE_PATH>/api):
  POST /analytics/collect              {events: [...]}  -> {stored: n}
  GET  /analytics/overview?from&to&... -> aggregates for the dashboard
  GET  /analytics/meta                 -> the filter values the UI offers

**The read endpoints are off unless ANALYTICS_DASHBOARD=true.** They report on
every account's activity, and the dashboard that reads them has no login of its
own, so shipping them enabled would put per-user behaviour behind a plain GET.
Off by default means a normal deploy of this server does not expose them at all;
turning them on is a deliberate local act. When disabled they 404 rather than
403 — a 403 confirms the endpoint exists.

Collecting is deliberately NOT gated: the main site should keep recording
whether or not anyone is looking at the dashboard, and the events it writes are
feature names, not content.
"""

import os
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from api.auth import current_user
from models.job import utcnow
from services import analytics_store

analytics_blueprint = Blueprint("analytics", __name__)

DEFAULT_DAYS = 30
MAX_DAYS = 365


def _dashboard_enabled() -> bool:
    """Read live rather than at import: tests flip it per-case, and it means a
    restart is enough to turn the dashboard off."""
    return os.environ.get("ANALYTICS_DASHBOARD", "false").lower() == "true"


@analytics_blueprint.route("/analytics/collect", methods=["POST"])
def collect():
    """Take a batch of events. Anonymous is fine — signed-out visitors are half
    the point — so there's no require_auth here; the session cookie is read only
    to attribute the batch when one happens to be present.

    Always 200 with a count. A tracking call must never surface as an error in
    the app it is measuring, so a batch that is entirely junk is a stored:0, not
    a 400.
    """
    body = request.get_json(silent=True) or {}
    user = current_user()
    stored = analytics_store.record_events(
        body.get("events"), user_id=user["id"] if user else None
    )
    return jsonify({"stored": stored}), 200


def _parse_range():
    """(start, end) from ?from=&to= ISO dates, defaulting to the last 30 days.

    `to` is inclusive of the whole day: a range picker that says 1st-8th should
    include everything that happened on the 8th.
    """
    now = utcnow()
    end = now
    start = now - timedelta(days=DEFAULT_DAYS)

    raw_from = request.args.get("from")
    raw_to = request.args.get("to")
    try:
        if raw_from:
            start = datetime.fromisoformat(raw_from)
        if raw_to:
            end = datetime.fromisoformat(raw_to) + timedelta(days=1)
    except ValueError:
        return None, None

    if end <= start:
        return None, None
    if end - start > timedelta(days=MAX_DAYS):
        start = end - timedelta(days=MAX_DAYS)
    return start, end


@analytics_blueprint.route("/analytics/overview", methods=["GET"])
def overview():
    if not _dashboard_enabled():
        return jsonify({"error": "Not found"}), 404

    start, end = _parse_range()
    if start is None:
        return jsonify({"error": "Invalid date range"}), 400

    audience = request.args.get("audience") or analytics_store.AUDIENCE_ALL
    if audience not in (
        analytics_store.AUDIENCE_ALL,
        analytics_store.AUDIENCE_SIGNED_IN,
        analytics_store.AUDIENCE_ANONYMOUS,
    ):
        return jsonify({"error": "Invalid audience"}), 400

    return jsonify(analytics_store.overview(
        start, end,
        plan=request.args.get("plan") or None,
        account_type=request.args.get("account_type") or None,
        audience=audience,
    )), 200


@analytics_blueprint.route("/analytics/meta", methods=["GET"])
def meta():
    """The filter values the dashboard offers, so its dropdowns come from the
    server's idea of the world rather than a second hardcoded copy."""
    if not _dashboard_enabled():
        return jsonify({"error": "Not found"}), 404

    from services.plan_store import PLAN_IDS
    return jsonify({
        "plans": list(PLAN_IDS),
        "account_types": ["patient", "clinician", "researcher", "student"],
        "audiences": [
            analytics_store.AUDIENCE_ALL,
            analytics_store.AUDIENCE_SIGNED_IN,
            analytics_store.AUDIENCE_ANONYMOUS,
        ],
        "action_names": sorted(analytics_store.ACTION_NAMES),
        "routes": sorted(analytics_store.ROUTE_PATTERNS),
    }), 200
