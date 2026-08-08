#!/usr/bin/env python3
"""
Run this ONCE from your flask-server directory:

    cd flask-server
    python3 apply_share_patch.py

It patches api/api_blueprint.py to add the share-token system. It prints a
clear ✅/⚠️ line for each of the 3 changes so you know exactly what landed
and what (if anything) needs a manual look. It refuses to run twice (checks
for its own marker first), and makes a .bak backup before touching anything.
"""
import sys
from pathlib import Path

TARGET = Path("api/api_blueprint.py")
MARKER = "# --- share-token routes (auto-patched) ---"

IMPORT_LINE = "from itsdangerous import URLSafeSerializer, BadSignature\n"
IMPORT_ANCHOR = "import hmac\n"

NEW_ROUTES = '''

{marker}
def _share_serializer():
    """Deterministic, stateless share tokens: same case_id always signs to
    the same token (no DB row, no mapping file). Reuses whatever secret
    Flask already has configured for sessions -- no new secret to manage.
    NOTE: this makes share URLs opaque, it is NOT an access-control layer;
    /api/get-report-data/<id> has no auth today regardless of this token."""
    secret = current_app.secret_key or os.getenv("SECRET_KEY") or "dev-only-insecure-fallback"
    return URLSafeSerializer(secret, salt="bodymaps-share-v1")


@api_blueprint.route('/share/<case_id>/token', methods=['POST'])
def create_share_token(case_id):
    if not _is_safe_id(case_id):
        return jsonify({{"error": "Invalid id"}}), 400
    token = _share_serializer().dumps(str(case_id))
    return jsonify({{"share_id": token, "url": f"{{_api_prefix_path()}}/share/{{token}}"}})


@api_blueprint.route('/share/<token>', methods=['GET'])
def get_shared_case(token):
    try:
        case_id = _share_serializer().loads(token)
    except BadSignature:
        return jsonify({{"error": "Invalid or expired share link"}}), 404
    data = _build_report_data(case_id)
    if "error" in data:
        status = 400 if data["error"] == "Invalid id parameter" else 500
        return jsonify(data), status
    return jsonify(data)


def _resolve_case_id_or_token(id_or_token: str):
    """Accepts either a raw numeric case id (existing links keep working)
    OR an opaque share token. Returns the real case_id, or None."""
    if str(id_or_token).isdigit():
        return str(id_or_token)
    try:
        case_id = _share_serializer().loads(id_or_token)
        return str(case_id) if str(case_id).isdigit() else None
    except BadSignature:
        return None
'''.format(marker=MARKER)

# Exact anchors copied from the current file content, so replacement is
# targeted and won't accidentally hit the wrong function.
REPORT_HTML_ANCHOR = '''links to the existing /generate-report-pdf/<id> route."""
    data = _build_report_data(id)
    if "error" in data:
        status = 400 if data["error"] == "Invalid id parameter" else 500
        return jsonify(data), status
    html_out = _build_report_html(data)
    return Response(html_out, mimetype="text/html")'''

REPORT_HTML_REPLACEMENT = '''links to the existing /generate-report-pdf/<id> route."""
    resolved = _resolve_case_id_or_token(id)
    if resolved is None:
        return jsonify({"error": "Invalid or expired link"}), 404
    data = _build_report_data(resolved)
    if "error" in data:
        status = 400 if data["error"] == "Invalid id parameter" else 500
        return jsonify(data), status
    html_out = _build_report_html(data)
    return Response(html_out, mimetype="text/html")'''

PDF_ANCHOR = '''    temp_pdf_path = f"{PDF_DIR}/temp_report_{id}.pdf"
    output_pdf_path = f"{PDF_DIR}/report_{id}.pdf"
    try:
        report_data = _build_report_data(id)'''

PDF_REPLACEMENT = '''    temp_pdf_path = f"{PDF_DIR}/temp_report_{id}.pdf"
    output_pdf_path = f"{PDF_DIR}/report_{id}.pdf"
    try:
        resolved = _resolve_case_id_or_token(id)
        if resolved is None:
            return jsonify({"error": "Invalid or expired link"}), 404
        report_data = _build_report_data(resolved)'''


def main():
    if not TARGET.exists():
        print(f"❌ Could not find {TARGET} — run this from inside flask-server/")
        sys.exit(1)

    text = TARGET.read_text()

    if MARKER in text:
        print("⚠️  This file already has the share-token patch applied. Doing nothing.")
        sys.exit(0)

    backup = TARGET.with_suffix(".py.bak")
    backup.write_text(text)
    print(f"📦 Backup saved to {backup}")

    # 1. Add the itsdangerous import
    if IMPORT_ANCHOR in text and IMPORT_LINE not in text:
        text = text.replace(IMPORT_ANCHOR, IMPORT_ANCHOR + IMPORT_LINE, 1)
        print("✅ Added itsdangerous import")
    else:
        print("⚠️  Could not find import anchor ('import hmac') — add manually:\n   " + IMPORT_LINE)

    # 2. Append the new routes at the end of the file
    text = text.rstrip() + "\n" + NEW_ROUTES + "\n"
    print("✅ Appended /share/<case_id>/token and /share/<token> routes")

    # 3. Patch report_html to accept tokens
    if REPORT_HTML_ANCHOR in text:
        text = text.replace(REPORT_HTML_ANCHOR, REPORT_HTML_REPLACEMENT, 1)
        print("✅ Patched report_html() to accept share tokens")
    else:
        print("⚠️  Could not find report_html() anchor — this route may have changed since "
              "this script was written. Apply the report_html edit manually (see chat).")

    # 4. Patch generate_report_pdf to accept tokens
    if PDF_ANCHOR in text:
        text = text.replace(PDF_ANCHOR, PDF_REPLACEMENT, 1)
        print("✅ Patched generate_report_pdf() to accept share tokens")
    else:
        print("⚠️  Could not find generate_report_pdf() anchor — apply that edit manually (see chat).")

    TARGET.write_text(text)
    print(f"\n✅ Done. Wrote changes to {TARGET}")
    print("   Now run: python3 -m py_compile api/api_blueprint.py")
    print(f"   If anything looks wrong, restore with: cp {backup} {TARGET}")


if __name__ == "__main__":
    main()
