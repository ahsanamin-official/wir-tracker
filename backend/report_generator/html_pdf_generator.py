"""
html_pdf_generator.py — built-in PDF generator that does NOT depend on
LibreOffice. It renders the report as HTML (styled to match the
Engineering Axis / PGSHF reference template: orange/black cover,
diagonal banner, PGSHF + Engineering Axis header on inner pages) and
converts it to PDF with wkhtmltopdf, then stitches the no-header cover
page together with the headered/footered body using pypdf.

Sections shown, their order, and page setup come from report_config.json
(or payload['reportConfig'] to override per-request) — the schema in
report_schema.json documents every field a section can use. Edit the
config to add/remove/reorder sections; no code changes required.
"""
import os
import json
import base64
import shutil
import subprocess
import tempfile
from html import escape

from pypdf import PdfWriter, PdfReader

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_config(payload):
    with open(os.path.join(HERE, 'report_config.json')) as f:
        config = json.load(f)
    override = payload.get('reportConfig')
    if override:
        config.update(override)
    return config


def _wkhtmltopdf_bin():
    return shutil.which('wkhtmltopdf')


def e(val):
    """HTML-escape, tolerating None."""
    return escape('' if val is None else str(val))


# ---------------------------------------------------------------
# Small HTML building blocks
# ---------------------------------------------------------------

def _table(headers, rows, col_classes=None):
    col_classes = col_classes or []
    thead = ''.join(f'<th>{e(h)}</th>' for h in headers)
    body_rows = []
    for row in rows:
        cells = ''.join(
            f'<td class="{col_classes[i] if i < len(col_classes) else ""}">{e(v) if v not in (None, "") else "-"}</td>'
            for i, v in enumerate(row)
        )
        body_rows.append(f'<tr>{cells}</tr>')
    if not rows:
        body_rows.append(f'<tr><td colspan="{len(headers)}" class="empty">No data entered for this reporting period.</td></tr>')
    return f'<table class="data-table"><thead><tr>{thead}</tr></thead><tbody>{"".join(body_rows)}</tbody></table>'


def _bullets(items):
    if not items:
        return ''
    return '<ul class="bullets">' + ''.join(f'<li>{e(i)}</li>' for i in items) + '</ul>'


def _photo_grid(photos, empty_msg):
    if not photos:
        return f'<p class="muted">{e(empty_msg)}</p>'
    figs = []
    for p in photos:
        src = p.get('dataUrl', '')
        cap = p.get('caption') or p.get('category', '')
        if src:
            figs.append(f'<figure><img src="{src}"/><figcaption>{e(cap)}</figcaption></figure>')
    return f'<div class="photo-grid">{"".join(figs)}</div>'


# ---------------------------------------------------------------
# Section renderers — each takes the payload and returns an HTML
# fragment. A section with no meaningful data still renders with a
# clear "no data" note (never silently disappears) unless it is
# absent from report_config.json entirely.
# ---------------------------------------------------------------

def sec_toc(payload, cfg):
    items = [s for s in cfg['sections'] if s not in ('cover', 'toc')]
    titles = {
        'client_details': '1. Client Details', 'introduction': '2. Introduction',
        'material_qa': '3. Material Quality Assurance & Field Verification',
        'baseline': '4. Pre-Consultancy Mobilization Baseline Record',
        'weekly_progress': '5. Weekly Progress Work',
        'highlights': '6. Weekly Progress Work Highlights',
        'cumulative_history': "7. Cumulative Project History Work Flow",
        'structural_breakdown': '8. Weekly Progress Breakdown by Structural Levels',
        'exec_summary': '9. Executive Summary & Engineering Conclusion',
    }
    rows = ''.join(f'<li><span>{e(titles.get(s, s))}</span></li>' for s in items if s in titles)
    return f'<section class="page-break"><h1>Table of Contents</h1><ul class="toc">{rows}</ul></section>'


def sec_client_details(payload, cfg):
    master = payload.get('masterData', {})
    report = payload.get('report', {})
    rows = [
        ['Project Title', master.get('projectTitle', '')],
        ['Client Organization', master.get('client', '')],
        ['Client Address', master.get('clientAddress', '')],
        ['Consultant Name', master.get('consultant', '')],
        ['Facility Type', master.get('facility', '')],
        ['Site Location', master.get('location', '')],
        ['Data Collection Week', f"{report.get('startDate','')} - {report.get('endDate','')} ({report.get('weekLabel','')})"],
        ['Total Project Duration', master.get('projectDuration', '')],
        ['Reporting Resident Engineer (RE)', master.get('residentEngineer', '')],
        ['Reporting Quality Inspector', master.get('qualityInspector', '')],
        ['Reporting Project Coordinator', master.get('projectCoordinator', '')],
    ]
    return f'<section class="page-break"><h1>1. Client Details</h1>{_table(["Parameter", "Project Details"], rows, ["param", ""])}</section>'


def sec_introduction(payload, cfg):
    master = payload.get('masterData', {})
    bullets = master.get('scopeBullets') or [
        'Engineering Supervision & Quality Control of all construction activities.',
        'Material Testing Certification for bricks, cement, sand, and aggregate.',
        'Work Progress Verification against approved schedules.',
        'Site Record & Daily Reporting of progress, workforce, and material utilization.',
        'Joint Measurements of completed work items with the contractor.',
        'Payment Bill Certification confirming quality alignment with specifications.',
        'Safety & Hazard Supervision on site.',
        'As-Built Review & Closeout at project completion.',
    ]
    background = master.get('projectBackground') or (
        f"The client, {master.get('client','')}, is executing this development scheme with a total allocated "
        f"project estimate of {master.get('projectEstimate','')}. {master.get('consultant','')} has been appointed "
        f"as the Resident Supervision Consultant, governed by {master.get('governingStandards','')}."
    )
    scope = master.get('objectiveScope') or (
        f"The objective of this consultancy assignment is to provide resident supervision for the construction of "
        f"{master.get('facility','')}, ensuring quality assurance, structural durability, and execution in "
        f"accordance with approved engineering drawings and technical specifications."
    )
    return (
        '<section class="page-break"><h1>2. Introduction</h1>'
        f'<h2>2.1 Project Background</h2><p>{e(background)}</p>'
        f'<h2>2.2 Objective and Scope</h2><p>{e(scope)}</p>{_bullets(bullets)}</section>'
    )


def sec_material_qa(payload, cfg):
    materials = payload.get('materials') or {}
    photos = [p for p in (payload.get('photos') or []) if p.get('category') in ('Visual Inspection', 'Material Delivery')]
    rows = []
    for key, label in [('cement', 'Cement'), ('bricks', 'Bricks'), ('fineAggregate', 'Fine Aggregate (Sand)'), ('coarseAggregate', 'Coarse Aggregate (Crush)')]:
        m = materials.get(key, {})
        if m:
            src = m.get('brand') or m.get('source') or ''
            rows.append([label, src, m.get('observation', ''), m.get('status', '')])
    terminology = payload.get('terminologyBullets') or [
        'First-Class Bricks (C&W Specs): thoroughly burnt, copper-colored, free from cracks; water absorption must not exceed 20% of dry weight over 24 hours.',
        'Efflorescence Monitoring: bricks must not deposit white alkaline salts after drying, which weaken the brick-mortar bond.',
        'Silt Content in Sand: silt exceeding 6% coats sand grains and reduces the compressive strength of mortar and concrete.',
        'Curing Water Quality (ACI 318 Context): water for mixing/curing must be clean and potable; impurities attack reinforcement and degrade mortar over time.',
    ]
    return (
        '<section class="page-break"><h1>3. Material Quality Assurance &amp; Field Verification</h1>'
        '<h2>3.1 Material Status and Inspection Matrix</h2>'
        f'{_table(["Material Type", "Source", "Field Quality Observation", "Compliance Status"], rows)}'
        '<h2>3.2 Engineering Terminology &amp; Field Quality Reference</h2>'
        f'{_bullets(terminology)}'
        '<h2>3.3 Visual Inspection of Material on Site</h2>'
        f'{_photo_grid(photos, "No material inspection photographs were uploaded for this reporting period.")}'
        '</section>'
    )


def sec_baseline(payload, cfg):
    master = payload.get('masterData', {})
    baseline = master.get('baseline', {}) or {}
    rows = [[q.get('activity', ''), q.get('wall1', ''), q.get('wall2', ''), q.get('wall3', '')] for q in baseline.get('quantities', [])]
    return (
        '<section class="page-break"><h1>4. Pre-Consultancy Mobilization Baseline Record</h1>'
        f'<p>This section establishes the technical and physical baseline of structural works executed by the '
        f'contractor prior to official mobilization and resident supervision of the Consultant on '
        f'{e(master.get("mobilizationDate",""))}.</p>'
        f'{_table(["Structural Element & Design Specification", "Wall-1 Progress", "Wall-2 Progress", "Wall-3 Progress"], rows)}'
        '</section>'
    )


def sec_weekly_progress(payload, cfg):
    report = payload.get('report', {})
    weekly_work = payload.get('weeklyProgressWork', {}) or {}
    blocks = [f'<p class="meta">Weather: {e(report.get("weather",""))} &nbsp;|&nbsp; Site Status: {e(report.get("siteStatus",""))}</p>']
    if weekly_work:
        for wall, cats in weekly_work.items():
            blocks.append(f'<h2>{e(wall)}</h2>')
            rows = []
            for cat, acts in cats.items():
                for a in acts:
                    rows.append([
                        cat, a.get('activityDescription', ''), a.get('unit', ''),
                        a.get('panels', '') or '-', a.get('length', '') or '-',
                        a.get('width', '') or '-', a.get('height', '') or '-', a.get('quantity', '') or '-',
                    ])
            blocks.append(_table(
                ['Category', 'Description', 'Unit', 'Nos/Panels', 'Length (ft)', 'Width (ft)', 'Depth/Height (ft)', 'Total Qty'],
                rows
            ))
    else:
        blocks.append('<p class="muted">No structural activities were entered for this reporting period.</p>')
    return f'<section class="page-break"><h1>5. Weekly Progress Work</h1>{"".join(blocks)}</section>'


def sec_highlights(payload, cfg):
    highlights = payload.get('highlights', []) or []
    photos = [p for p in (payload.get('photos') or []) if p.get('category') == 'Progress Photo']
    return (
        '<section class="page-break"><h1>6. Weekly Progress Work Highlights</h1>'
        f'{_bullets(highlights)}'
        f'{_photo_grid(photos, "No progress photographs were uploaded for this reporting period.")}'
        '</section>'
    )


def sec_cumulative_history(payload, cfg):
    cumulative = payload.get('cumulativeHistory', {'rows': [], 'totals': {}}) or {'rows': [], 'totals': {}}
    rows = []
    for r in cumulative.get('rows', []):
        rows.append([r.get('date', ''), r.get('reportId', ''), r.get('bricks'), r.get('cement'),
                     r.get('fineSand'), r.get('coarseAgg'), r.get('steel'), r.get('remarks', '')])
    totals = cumulative.get('totals', {})
    if rows:
        rows.append(['Total', totals.get('reportId', ''), totals.get('bricks', '-'), totals.get('cement', '-'),
                      totals.get('fineSand', '-'), totals.get('coarseAgg', '-'), totals.get('steel', '-'), 'Details Above'])
    return (
        '<section class="page-break"><h1>7. Cumulative Project History Work Flow (1 Panel = 36\'-0")</h1>'
        f'{_table(["Date", "Report ID", "Bricks (Nos.)", "Cement (Bags)", "Fine Sand (ft\u00b3)", "Coarse Agg (ft\u00b3)", "Steel (Tons)", "Remarks"], rows)}'
        '</section>'
    )


def sec_structural_breakdown(payload, cfg):
    report = payload.get('report', {})
    breakdown = payload.get('structuralBreakdown', []) or []
    rows = [[b.get('label', ''), b.get('wall1', '-'), b.get('wall2', '-'), b.get('wall3', '-'), b.get('weeklyTotal', '-')] for b in breakdown]
    title = f"8. Weekly Progress Breakdown by Structural Levels ({e(report.get('startDate',''))} - {e(report.get('endDate',''))})"
    return (
        f'<section class="page-break"><h1>{title}</h1>'
        f'{_table(["Structural Element & Design Specifications", "Wall-1 Progress", "Wall-2 Progress", "Wall-3 Progress", "Weekly Cumulative Total"], rows)}'
        '</section>'
    )


def sec_exec_summary(payload, cfg):
    paras = payload.get('execSummary', []) or []
    body = ''.join(f'<p>{e(p)}</p>' for p in paras) or '<p class="muted">No executive summary was entered for this reporting period.</p>'
    return f'<section class="page-break"><h1>9. Executive Summary &amp; Engineering Conclusion</h1>{body}</section>'


SECTION_RENDERERS = {
    'toc': sec_toc,
    'client_details': sec_client_details,
    'introduction': sec_introduction,
    'material_qa': sec_material_qa,
    'baseline': sec_baseline,
    'weekly_progress': sec_weekly_progress,
    'highlights': sec_highlights,
    'cumulative_history': sec_cumulative_history,
    'structural_breakdown': sec_structural_breakdown,
    'exec_summary': sec_exec_summary,
}


# ---------------------------------------------------------------
# Cover page (reference template: orange/black diagonal banner,
# consultant wordmark, client/consultant/location strip, report
# meta block at the bottom).
# ---------------------------------------------------------------

def _build_cover_html(payload, cfg):
    master = payload.get('masterData', {})
    report = payload.get('report', {})
    branding = cfg.get('branding', {})
    accent = branding.get('accentColor', '#E8622C')
    dark = branding.get('darkColor', '#1A1A1A')
    consultant_name = branding.get('consultantName', 'ENGINEERING AXIS')
    tagline = branding.get('consultantTagline', 'Delivering Excellence')

    cover_photo = ''
    photos = payload.get('photos') or []
    banner_photo = next((p for p in photos if p.get('dataUrl')), None)
    if banner_photo:
        cover_photo = f'<img class="cover-banner-img" src="{banner_photo.get("dataUrl")}"/>'

    html = f"""
    <div class="cover-page">
      <div class="cover-top">
        <div class="cover-logo-mark">{e(consultant_name)}</div>
        <div class="cover-tagline">{e(tagline)}</div>
        <div class="hr"></div>
        <h1 class="cover-title">WEEKLY PROGRESS <span class="accent">REPORT</span></h1>
        <p class="cover-subtitle">{e(master.get('projectTitle', ''))}</p>
        <div class="cover-strip">
          <div class="strip-item"><b>CLIENT</b><span>{e(master.get('client',''))}</span></div>
          <div class="strip-item"><b>CONSULTANT</b><span>{e(master.get('consultant', consultant_name))}</span></div>
          <div class="strip-item"><b>PROJECT LOCATION</b><span>{e(master.get('location',''))}</span></div>
        </div>
      </div>
      <div class="cover-banner">
        {cover_photo}
        <div class="cover-banner-overlay">
          <div class="cover-banner-title">CONSTRUCTION SUPERVISION SERVICES</div>
          <div class="cover-banner-sub">{e(master.get('facility',''))}</div>
        </div>
      </div>
      <div class="cover-meta">
        <div class="meta-row"><span class="meta-label">REPORT NO.</span><span>:</span><span>{e(report.get('reportNumber',''))}</span></div>
        <div class="meta-row"><span class="meta-label">REPORTING PERIOD</span><span>:</span><span>{e(report.get('startDate',''))} &ndash; {e(report.get('endDate',''))}</span></div>
        <div class="meta-row"><span class="meta-label">PREPARED BY</span><span>:</span><span>{e(report.get('preparedBy','DESIGN & SUPERVISION TEAM'))}</span></div>
      </div>
      <div class="cover-footer">
        <div class="hr light"></div>
        <div class="cover-footer-name">{e(consultant_name)}</div>
        <div class="cover-footer-tagline">{e(tagline)}</div>
      </div>
    </div>
    """
    return html


# ---------------------------------------------------------------
# CSS — orange/black scheme matching the reference template.
# ---------------------------------------------------------------

def _build_css(cfg):
    branding = cfg.get('branding', {})
    accent = branding.get('accentColor', '#E8622C')
    dark = branding.get('darkColor', '#1A1A1A')
    margins = cfg.get('pageSetup', {}).get('margins', {})
    return f"""
    @page {{ size: A4; margin: 0; }}
    * {{ box-sizing: border-box; }}
    html, body {{ font-family: 'Helvetica', 'Arial', sans-serif; color: #222; margin: 0; width: 100%; }}
    .page-break {{ page-break-before: always; padding: 8mm {margins.get('right','16mm')} 18mm {margins.get('left','16mm')}; }}
    section:first-of-type.page-break {{ page-break-before: avoid; }}
    .section-header {{ display:flex; justify-content:space-between; align-items:center;
                        padding-bottom: 2mm; margin-bottom: 6mm;
                        border-bottom: 1.5px solid {accent}; font-weight: 800; font-size: 11pt; color: {dark}; }}
    .section-footer {{ margin-top: 10mm; padding-top: 2mm; border-top: 0.5px solid #ddd;
                        text-align: center; font-size: 8pt; color: #777; }}
    h1 {{ color: {dark}; font-size: 16pt; border-bottom: 2px solid {accent}; padding-bottom: 4px; margin-top: 0; }}
    h2 {{ color: {dark}; font-size: 12.5pt; margin-top: 16px; }}
    p {{ font-size: 10.5pt; line-height: 1.5; }}
    p.meta {{ font-size: 10pt; color: #444; font-style: italic; }}
    p.muted {{ font-style: italic; color: #777; }}
    ul.bullets {{ font-size: 10.5pt; line-height: 1.5; padding-left: 18px; }}
    ul.bullets li {{ margin-bottom: 4px; }}
    table.data-table {{ width: 100%; border-collapse: collapse; margin: 10px 0 16px; font-size: 9.5pt; }}
    table.data-table th {{ background: {dark}; color: #fff; padding: 6px 8px; text-align: left; border: 1px solid {dark}; }}
    table.data-table td {{ padding: 6px 8px; border: 1px solid #ccc; vertical-align: top; }}
    table.data-table td.param {{ font-weight: bold; background: #f4f4f4; width: 32%; }}
    table.data-table td.empty {{ text-align: center; font-style: italic; color: #888; }}
    ul.toc {{ list-style: none; padding: 0; font-size: 11pt; }}
    ul.toc li {{ display: flex; justify-content: space-between; border-bottom: 1px dotted #bbb; padding: 6px 0; }}
    .photo-grid {{ display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }}
    .photo-grid figure {{ width: 47%; margin: 0; }}
    .photo-grid img {{ width: 100%; border: 1px solid #ccc; display: block; }}
    .photo-grid figcaption {{ font-size: 8.5pt; font-style: italic; text-align: center; color: #555; margin-top: 3px; }}

    /* ---------------- Cover page ---------------- */
    .cover-page {{ width: 100%; min-height: 287mm; position: relative; background: #fff; overflow: hidden; }}
    .cover-top {{ padding: 14mm 16mm 0; }}
    .cover-logo-mark {{ font-size: 22pt; font-weight: 800; color: {dark}; letter-spacing: 1px; }}
    .cover-tagline {{ font-size: 10.5pt; font-style: italic; color: #555; margin-top: 2px; }}
    .hr {{ height: 2px; background: {accent}; margin: 10px 0 18px; }}
    .hr.light {{ background: rgba(255,255,255,0.4); }}
    .cover-title {{ font-size: 27pt; font-weight: 900; color: {dark}; margin: 0; text-transform: uppercase; }}
    .cover-title .accent {{ color: {accent}; }}
    .cover-subtitle {{ font-size: 11.5pt; font-weight: 600; color: #333; margin-top: 4px; }}
    .cover-strip {{ display: flex; gap: 20px; margin: 16px 0 6px; }}
    .strip-item {{ flex: 1; font-size: 9pt; }}
    .strip-item b {{ display: block; color: {accent}; letter-spacing: 0.5px; font-size: 8pt; }}
    .strip-item span {{ display: block; font-weight: 600; color: {dark}; margin-top: 2px; }}
    .cover-banner {{ position: relative; height: 92mm; margin-top: 6mm; background: {dark}; overflow: hidden; }}
    .cover-banner-img {{ width: 100%; height: 100%; object-fit: cover; opacity: 0.85; }}
    .cover-banner-overlay {{ position: absolute; left: 0; bottom: 0; background: rgba(0,0,0,0.55); color: #fff;
                              padding: 10px 16mm; width: 100%; }}
    .cover-banner-title {{ font-size: 14pt; font-weight: 800; }}
    .cover-banner-sub {{ font-size: 10pt; margin-top: 2px; }}
    .cover-meta {{ padding: 10mm 16mm 0; }}
    .meta-row {{ display: grid; grid-template-columns: 45mm 6mm auto; font-size: 10pt; margin-bottom: 6px; }}
    .meta-label {{ font-weight: 800; color: {accent}; }}
    .cover-footer {{ position: absolute; bottom: 10mm; left: 16mm; right: 16mm; text-align: center; }}
    .cover-footer-name {{ font-size: 13pt; font-weight: 800; color: {dark}; }}
    .cover-footer-tagline {{ font-size: 9pt; font-style: italic; color: #555; }}
    """


def _section_header_html(cfg, payload):
    """
    This build of wkhtmltopdf ships an unpatched Qt/WebKit, so
    --header-html/--footer-html are silently ignored, and (unlike a
    patched build) `position: fixed` elements here are painted only
    once at the top/bottom of the whole rendered canvas rather than
    repeated on every printed page. To still give every section's page
    the PGSHF / consultant identification the reference template shows
    on each page, the header bar is emitted as normal (non-fixed)
    content at the start of every section instead — sections map 1:1
    to pages for most of this report, so in practice it reads as a
    per-page header even though it's technically per-section.
    """
    branding = cfg.get('branding', {})
    client_logo_text = branding.get('clientLogoText', 'PGSHF')
    consultant_name = branding.get('consultantName', 'ENGINEERING AXIS')
    return (f'<div class="section-header"><span class="left">{e(client_logo_text)}</span>'
            f'<span class="right">{e(consultant_name)}</span></div>')


def _section_footer_html(cfg, payload):
    branding = cfg.get('branding', {})
    consultant_name = branding.get('consultantName', 'ENGINEERING AXIS')
    report = payload.get('report', {})
    return (f'<div class="section-footer">{e(report.get("reportNumber",""))} &nbsp;|&nbsp; '
            f'{e(consultant_name)} (Pvt.) Ltd.</div>')


def _run_wkhtmltopdf(args):
    binary = _wkhtmltopdf_bin()
    if not binary:
        raise RuntimeError('wkhtmltopdf is not installed / not on PATH.')
    subprocess.run([binary, '--quiet', '--enable-local-file-access'] + args,
                    check=True, timeout=180, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def build_pdf(payload, output_path):
    """
    Built-in HTML -> PDF report generator. Does not require LibreOffice.
    Renders directly from the same payload shape used by build_docx().
    """
    cfg = _load_config(payload)
    css = _build_css(cfg)

    header_bar = _section_header_html(cfg, payload)
    footer_bar = _section_footer_html(cfg, payload)

    body_fragments = []
    for name in cfg['sections']:
        if name in ('cover',):
            continue
        renderer = SECTION_RENDERERS.get(name)
        if not renderer:
            continue
        frag = renderer(payload, cfg)
        # Inject the per-page-look header right after the section opens,
        # and the footer right before it closes (see _section_header_html
        # for why this isn't done as a single wkhtmltopdf-repeated header).
        frag = frag.replace('<section class="page-break">', f'<section class="page-break">{header_bar}', 1)
        if frag.endswith('</section>'):
            frag = frag[: -len('</section>')] + footer_bar + '</section>'
        body_fragments.append(frag)

    body_html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"/><style>{css}</style></head>
    <body>{"".join(body_fragments)}</body></html>"""

    cover_html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"/><style>{css}</style></head>
    <body>{_build_cover_html(payload, cfg)}</body></html>"""

    with tempfile.TemporaryDirectory() as tmp:
        cover_html_path = os.path.join(tmp, 'cover.html')
        body_html_path = os.path.join(tmp, 'body.html')
        cover_pdf = os.path.join(tmp, 'cover.pdf')
        body_pdf = os.path.join(tmp, 'body.pdf')

        with open(cover_html_path, 'w') as f:
            f.write(cover_html)
        with open(body_html_path, 'w') as f:
            f.write(body_html)

        # Cover: full-bleed page, margins handled entirely by its own CSS.
        _run_wkhtmltopdf(['--page-size', 'A4', '--margin-top', '0', '--margin-bottom', '0',
                           '--margin-left', '0', '--margin-right', '0', cover_html_path, cover_pdf])

        # Body: margins are 0 here too — the repeating header/footer bars
        # and section padding are handled in CSS (see _build_css /
        # _fixed_header_footer_html) because this wkhtmltopdf build's
        # WebKit is unpatched and ignores --header-html/--footer-html.
        _run_wkhtmltopdf(['--page-size', 'A4', '--margin-top', '0', '--margin-bottom', '0',
                           '--margin-left', '0', '--margin-right', '0', body_html_path, body_pdf])

        writer = PdfWriter()
        for src in (cover_pdf, body_pdf):
            reader = PdfReader(src)
            for page in reader.pages:
                writer.add_page(page)
        with open(output_path, 'wb') as f:
            writer.write(f)

    return output_path
