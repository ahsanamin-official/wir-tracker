"""
WIR Weekly Progress Reporting — Local Flask API
Run: python app.py   (serves on http://localhost:5000)

Storage: simple JSON files under backend/data/ (mirrors the frontend's
IndexedDB records so the two can be used together or independently).
The frontend works fully offline without this server; when the server
is running it is used for DOCX/PDF generation and as a shared backing
store.
"""
import os
import json
import uuid
from datetime import datetime
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

from report_generator.docx_generator import build_docx
from report_generator.pdf_generator import docx_to_pdf
from report_generator.html_pdf_generator import build_pdf as build_pdf_native

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
OUTPUT_DIR = os.path.join(BASE_DIR, 'output')
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

app = Flask(__name__)
CORS(app)

FILES = {
    'projects': os.path.join(DATA_DIR, 'project.json'),
    'reports': os.path.join(DATA_DIR, 'reports.json'),
    'daily': os.path.join(DATA_DIR, 'daily_progress.json'),
    'materials': os.path.join(DATA_DIR, 'materials.json'),
    'photos': os.path.join(DATA_DIR, 'photos.json'),
}


def _read(key, default):
    path = FILES[key]
    if not os.path.exists(path):
        return default
    with open(path, 'r', encoding='utf-8') as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return default


def _write(key, data):
    with open(FILES[key], 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------
# Health
# ---------------------------------------------------------------
@app.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'time': datetime.utcnow().isoformat()})


# ---------------------------------------------------------------
# Project / master data
# ---------------------------------------------------------------
@app.route('/api/projects', methods=['GET'])
def get_project():
    return jsonify(_read('projects', {}))


@app.route('/api/projects', methods=['PUT'])
def save_project():
    data = request.get_json(force=True)
    _write('projects', data)
    return jsonify(data)


# ---------------------------------------------------------------
# Reports
# ---------------------------------------------------------------
@app.route('/api/reports', methods=['GET'])
def list_reports():
    return jsonify(_read('reports', []))


@app.route('/api/reports', methods=['POST'])
def create_report():
    reports = _read('reports', [])
    payload = request.get_json(force=True)
    if not payload.get('id'):
        payload['id'] = 'rep_' + uuid.uuid4().hex[:10]
    payload['lastUpdated'] = datetime.utcnow().isoformat()
    reports = [r for r in reports if r['id'] != payload['id']]
    reports.append(payload)
    _write('reports', reports)
    return jsonify(payload), 201


@app.route('/api/reports/<report_id>', methods=['GET'])
def get_report(report_id):
    reports = _read('reports', [])
    rep = next((r for r in reports if r['id'] == report_id), None)
    if not rep:
        return jsonify({'error': 'not found'}), 404
    return jsonify(rep)


@app.route('/api/reports/<report_id>', methods=['PUT'])
def update_report(report_id):
    reports = _read('reports', [])
    payload = request.get_json(force=True)
    payload['id'] = report_id
    payload['lastUpdated'] = datetime.utcnow().isoformat()
    reports = [payload if r['id'] == report_id else r for r in reports]
    _write('reports', reports)
    return jsonify(payload)


@app.route('/api/reports/<report_id>', methods=['DELETE'])
def delete_report(report_id):
    reports = [r for r in _read('reports', []) if r['id'] != report_id]
    _write('reports', reports)
    daily = [d for d in _read('daily', []) if d.get('reportId') != report_id]
    _write('daily', daily)
    materials = [m for m in _read('materials', []) if m.get('reportId') != report_id]
    _write('materials', materials)
    photos = [p for p in _read('photos', []) if p.get('reportId') != report_id]
    _write('photos', photos)
    return jsonify({'deleted': True})


# ---------------------------------------------------------------
# Daily progress
# ---------------------------------------------------------------
@app.route('/api/daily-progress', methods=['POST'])
def save_daily_progress():
    records = _read('daily', [])
    payload = request.get_json(force=True)
    if not payload.get('id'):
        payload['id'] = 'day_' + uuid.uuid4().hex[:10]
    records = [r for r in records if r['id'] != payload['id']]
    records.append(payload)
    _write('daily', records)
    return jsonify(payload), 201


@app.route('/api/daily-progress', methods=['GET'])
def get_daily_progress():
    report_id = request.args.get('reportId')
    records = _read('daily', [])
    if report_id:
        records = [r for r in records if r.get('reportId') == report_id]
    return jsonify(records)


# ---------------------------------------------------------------
# Materials
# ---------------------------------------------------------------
@app.route('/api/materials', methods=['POST'])
def save_materials():
    records = _read('materials', [])
    payload = request.get_json(force=True)
    if not payload.get('id'):
        payload['id'] = 'mat_' + payload.get('reportId', uuid.uuid4().hex[:10])
    records = [r for r in records if r['id'] != payload['id']]
    records.append(payload)
    _write('materials', records)
    return jsonify(payload), 201


# ---------------------------------------------------------------
# Photos
# ---------------------------------------------------------------
@app.route('/api/photos', methods=['POST'])
def save_photo():
    records = _read('photos', [])
    payload = request.get_json(force=True)
    if not payload.get('id'):
        payload['id'] = 'photo_' + uuid.uuid4().hex[:10]
    records.append(payload)
    _write('photos', records)
    return jsonify(payload), 201


# ---------------------------------------------------------------
# Cumulative progress
# ---------------------------------------------------------------
@app.route('/api/cumulative-progress', methods=['GET'])
def cumulative_progress():
    daily = _read('daily', [])
    totals = {
        'bricksConsumed': sum(float(d.get('bricksConsumed') or 0) for d in daily),
        'cementBags': sum(float(d.get('cementBags') or 0) for d in daily),
        'fineSandVol': sum(float(d.get('fineSandVol') or 0) for d in daily),
        'coarseAggVol': sum(float(d.get('coarseAggVol') or 0) for d in daily),
        'steelTons': sum(float(d.get('steelTons') or 0) for d in daily),
    }
    return jsonify(totals)


# ---------------------------------------------------------------
# Report generation (DOCX / PDF)
# The frontend sends the FULL compiled payload built by reports.js
# (ReportEngine.buildReportPayload) so the backend never has to
# re-derive or invent anything — it only lays the given data into
# the Word document structure.
# ---------------------------------------------------------------
@app.route('/api/generate-report', methods=['POST'])
def generate_report():
    fmt = request.args.get('format', 'docx')
    payload = request.get_json(force=True)
    report_number = payload.get('report', {}).get('reportNumber', 'WIR-Report')
    safe_name = ''.join(c for c in report_number if c.isalnum() or c in ('-', '_')) or 'WIR-Report'
    docx_path = os.path.join(OUTPUT_DIR, f'{safe_name}.docx')

    if fmt == 'pdf':
        pdf_path = os.path.join(OUTPUT_DIR, f'{safe_name}.pdf')
        # Preferred path: built-in HTML->PDF generator (wkhtmltopdf), no
        # LibreOffice dependency, styled to match the reference template.
        try:
            build_pdf_native(payload, pdf_path)
            return send_file(pdf_path, as_attachment=True, download_name=f'{safe_name}.pdf')
        except Exception:
            pass
        # Fallback: build the .docx and convert via LibreOffice if available.
        build_docx(payload, docx_path)
        ok = docx_to_pdf(docx_path, OUTPUT_DIR)
        if not ok or not os.path.exists(pdf_path):
            return jsonify({'error': 'PDF generation failed (both the built-in HTML renderer and the LibreOffice fallback failed).'}), 500
        return send_file(pdf_path, as_attachment=True, download_name=f'{safe_name}.pdf')

    build_docx(payload, docx_path)
    return send_file(docx_path, as_attachment=True, download_name=f'{safe_name}.docx')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
