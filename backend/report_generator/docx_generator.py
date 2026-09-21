"""
docx_generator.py — builds the Weekly Inspection Report .docx file
using python-docx, following the exact 9-section structure of the
sample WIR-09-JH / WIR-10-JH reports. No section is added beyond
what is listed here; all figures come from the payload built by the
frontend (frontend/js/reports.js -> ReportEngine.buildReportPayload).
"""
import base64
import io
from docx import Document
from docx.shared import Pt, Inches, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

NAVY = RGBColor(0x16, 0x23, 0x3A)
STEEL = RGBColor(0x4A, 0x6F, 0xA5)


def _shade_cell(cell, hex_color):
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_color)
    cell._tc.get_or_add_tcPr().append(shd)


def _set_cell_text(cell, text, bold=False, color=None, size=10, align=None):
    cell.text = ''
    p = cell.paragraphs[0]
    if align:
        p.alignment = align
    run = p.add_run('' if text is None else str(text))
    run.bold = bold
    run.font.size = Pt(size)
    if color:
        run.font.color.rgb = color


def _heading(doc, level, text):
    h = doc.add_heading(text, level=level)
    for run in h.runs:
        run.font.color.rgb = NAVY
    return h


def _add_table(doc, headers, rows, col_widths=None, header_fill='16233A'):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr_cells = table.rows[0].cells
    for i, h in enumerate(headers):
        _set_cell_text(hdr_cells[i], h, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF), size=9)
        _shade_cell(hdr_cells[i], header_fill)
    for row in rows:
        cells = table.add_row().cells
        for i, val in enumerate(row):
            _set_cell_text(cells[i], val, size=9)
    if col_widths:
        for i, w in enumerate(col_widths):
            for row in table.rows:
                row.cells[i].width = Inches(w)
    return table


def _add_para(doc, text, size=10, bold=False, italic=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    return p


def _add_bullets(doc, items):
    for item in items:
        p = doc.add_paragraph(style='List Bullet')
        run = p.add_run(item)
        run.font.size = Pt(10)


def _add_image_from_dataurl(doc, data_url, width_in=3.0):
    try:
        header, b64data = data_url.split(',', 1)
        img_bytes = base64.b64decode(b64data)
        doc.add_picture(io.BytesIO(img_bytes), width=Inches(width_in))
    except Exception:
        _add_para(doc, '[Image could not be embedded]', italic=True)


def build_docx(payload, output_path):
    master = payload.get('masterData', {})
    report = payload.get('report', {})
    materials = payload.get('materials')
    photos = payload.get('photos', []) or []
    weekly_work = payload.get('weeklyProgressWork', {}) or {}
    highlights = payload.get('highlights', []) or []
    cumulative = payload.get('cumulativeHistory', {'rows': [], 'totals': {}})
    breakdown = payload.get('structuralBreakdown', []) or []
    exec_summary = payload.get('execSummary', []) or []
    baseline = master.get('baseline', {'quantities': [], 'specs': []})

    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.left_margin = Cm(2.2)
    section.right_margin = Cm(2.2)

    style = doc.styles['Normal']
    style.font.name = 'Calibri'
    style.font.size = Pt(10.5)

    # ---------------- Title Page ----------------
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title.add_run('WEEKLY INSPECTION REPORT')
    run.bold = True
    run.font.size = Pt(20)
    run.font.color.rgb = NAVY

    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r2 = sub.add_run(f"{report.get('reportNumber', '')}  |  {report.get('weekLabel', '')}")
    r2.font.size = Pt(13)
    r2.font.color.rgb = STEEL

    sub2 = doc.add_paragraph()
    sub2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r3 = sub2.add_run(f"{report.get('startDate', '')}  to  {report.get('endDate', '')}")
    r3.font.size = Pt(11)

    doc.add_paragraph()

    # ---------------- 1. Client Details ----------------
    _heading(doc, 1, '1. Client Details')
    _add_table(doc, ['Parameter', 'Project Details'], [
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
    ], col_widths=[2.2, 4.2])

    doc.add_page_break()

    # ---------------- 2. Introduction ----------------
    _heading(doc, 1, '2. Introduction')
    _heading(doc, 2, '2.1 Project Background')
    _add_para(doc, f"The client, {master.get('client','')}, is executing this development scheme with a total "
                    f"allocated project estimate of {master.get('projectEstimate','')}. {master.get('consultant','')} "
                    f"has been appointed as the Resident Supervision Consultant, governed by {master.get('governingStandards','')}")

    _heading(doc, 2, '2.2 Objective and Scope')
    _add_para(doc, f"The objective of this consultancy assignment is to provide resident supervision for the "
                    f"construction of {master.get('facility','')}, ensuring quality assurance, structural durability, "
                    f"and execution in accordance with approved engineering drawings and technical specifications.")
    _add_bullets(doc, [
        'Engineering Supervision & Quality Control of all construction activities.',
        'Material Testing Certification for bricks, cement, sand, and aggregate.',
        'Work Progress Verification against approved schedules.',
        'Site Record & Daily Reporting of progress, workforce, and material utilization.',
        'Joint Measurements of completed work items with the contractor.',
        "Payment Bill Certification confirming quality alignment with specifications.",
        'Safety & Hazard Supervision on site.',
        'As-Built Review & Closeout at project completion.'
    ])

    doc.add_page_break()

    # ---------------- 3. Material QA ----------------
    _heading(doc, 1, '3. Material Quality Assurance & Field Verification')
    _heading(doc, 2, '3.1 Material Status and Inspection Matrix')
    if materials:
        rows = []
        for key, label in [('cement', 'Cement'), ('bricks', 'Bricks'), ('fineAggregate', 'Fine Aggregate (Sand)'), ('coarseAggregate', 'Coarse Aggregate (Crush)')]:
            m = materials.get(key, {})
            src = m.get('brand') or m.get('source') or ''
            rows.append([label, src, m.get('observation', ''), m.get('status', '')])
        _add_table(doc, ['Material Type', 'Source', 'Field Quality Observation', 'Compliance Status'], rows, col_widths=[1.3, 1.3, 3.0, 1.3])
    else:
        _add_para(doc, 'No material inspection record was entered for this reporting period.', italic=True)

    _heading(doc, 2, '3.2 Engineering Terminology & Field Quality Reference')
    _add_bullets(doc, [
        'First-Class Bricks (C&W Specs): Bricks must be thoroughly burnt, copper-colored, and free from cracks or flaws, and must not absorb more than 20% of dry weight in water over 24 hours.',
        'Efflorescence Monitoring: A field check ensuring bricks do not deposit white alkaline salts after drying, which weaken the brick-mortar bond.',
        'Silt Content in Sand: Silt exceeding 6% coats sand grains and reduces the compressive strength of mortar and concrete.',
        'Curing Water Quality (ACI 318 Context): Water used for mixing and curing must be clean and potable; impurities attack reinforcement and degrade mortar over time.'
    ])

    _heading(doc, 2, '3.3 Visual Inspection of Material on Site')
    material_photos = [p for p in photos if p.get('category') in ('Visual Inspection', 'Material Delivery')]
    if material_photos:
        for p in material_photos:
            _add_image_from_dataurl(doc, p.get('dataUrl', ''))
            cap = doc.add_paragraph()
            cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r = cap.add_run(p.get('caption') or p.get('category', ''))
            r.italic = True
            r.font.size = Pt(9)
    else:
        _add_para(doc, 'No material inspection photographs were uploaded for this reporting period.', italic=True)

    doc.add_page_break()

    # ---------------- 4. Baseline ----------------
    _heading(doc, 1, '4. Pre-Consultancy Mobilization Baseline Record')
    _add_para(doc, f"This section establishes the technical and physical baseline of structural works executed by "
                    f"the contractor prior to official mobilization and resident supervision of the Consultant on "
                    f"{master.get('mobilizationDate','')}.")
    rows = [[q.get('activity', ''), q.get('wall1', ''), q.get('wall2', ''), q.get('wall3', '')] for q in baseline.get('quantities', [])]
    _add_table(doc, ['Structural Element & Design Specification', 'Wall-1 Progress', 'Wall-2 Progress', 'Wall-3 Progress'], rows, col_widths=[3.2, 1.2, 1.2, 1.2])

    doc.add_page_break()

    # ---------------- 5. Weekly Progress Work ----------------
    _heading(doc, 1, '5. Weekly Progress Work')
    _add_para(doc, f"Weather: {report.get('weather','')}   |   Site Status: {report.get('siteStatus','')}")
    if weekly_work:
        for wall, cats in weekly_work.items():
            _heading(doc, 2, wall)
            rows = []
            for cat, acts in cats.items():
                for a in acts:
                    rows.append([
                        cat, a.get('activityDescription', ''), a.get('unit', ''),
                        a.get('panels', '') or '-', a.get('length', '') or '-',
                        a.get('width', '') or '-', a.get('height', '') or '-', a.get('quantity', '') or '-'
                    ])
            _add_table(doc, ['Category', 'Description', 'Unit', 'Nos/Panels', 'Length (ft)', 'Width (ft)', 'Depth/Height (ft)', 'Total Qty'], rows,
                       col_widths=[1.1, 1.6, 0.6, 0.7, 0.8, 0.8, 0.9, 0.8])
    else:
        _add_para(doc, 'No structural activities were entered for this reporting period.', italic=True)

    doc.add_page_break()

    # ---------------- 6. Highlights ----------------
    _heading(doc, 1, '6. Weekly Progress Work Highlights')
    _add_bullets(doc, highlights)
    highlight_photos = [p for p in photos if p.get('category') == 'Progress Photo']
    for p in highlight_photos:
        _add_image_from_dataurl(doc, p.get('dataUrl', ''))
        cap = doc.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = cap.add_run(p.get('caption') or 'Site Progress Photo')
        r.italic = True
        r.font.size = Pt(9)

    doc.add_page_break()

    # ---------------- 7. Cumulative History ----------------
    _heading(doc, 1, "7. Cumulative Project History Work Flow (1 Panel = 36'-0\")")
    rows = []
    for r in cumulative.get('rows', []):
        rows.append([
            r.get('date', ''), r.get('reportId', ''), r.get('bricks', '-') if r.get('bricks') is not None else '-',
            r.get('cement', '-') if r.get('cement') is not None else '-',
            r.get('fineSand', '-') if r.get('fineSand') is not None else '-',
            r.get('coarseAgg', '-') if r.get('coarseAgg') is not None else '-',
            r.get('steel', '-') if r.get('steel') is not None else '-',
            r.get('remarks', '')
        ])
    totals = cumulative.get('totals', {})
    rows.append(['Total', totals.get('reportId', ''), totals.get('bricks', '-'), totals.get('cement', '-'),
                 totals.get('fineSand', '-'), totals.get('coarseAgg', '-'), totals.get('steel', '-'), 'Details Above'])
    _add_table(doc, ['Date', 'Report ID', 'Bricks (Nos.)', 'Cement (Bags)', 'Fine Sand (ft³)', 'Coarse Agg (ft³)', 'Steel (Tons)', 'Remarks'], rows,
               col_widths=[0.9, 0.9, 0.8, 0.8, 0.8, 0.8, 0.7, 1.5])

    doc.add_page_break()

    # ---------------- 8. Structural Breakdown ----------------
    _heading(doc, 1, f"8. Weekly Progress Breakdown by Structural Levels ({report.get('startDate','')} - {report.get('endDate','')})")
    rows = [[b.get('label', ''), b.get('wall1', '-'), b.get('wall2', '-'), b.get('wall3', '-'), b.get('weeklyTotal', '-')] for b in breakdown]
    _add_table(doc, ['Structural Element & Design Specifications', 'Wall-1 Progress', 'Wall-2 Progress', 'Wall-3 Progress', 'Weekly Cumulative Total'], rows,
               col_widths=[2.6, 1.0, 1.0, 1.0, 1.1])

    doc.add_page_break()

    # ---------------- 9. Executive Summary ----------------
    _heading(doc, 1, '9. Executive Summary & Engineering Conclusion')
    for para in exec_summary:
        _add_para(doc, para)

    # Footer with page numbers
    footer = section.footer
    fp = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = fp.add_run(f"{report.get('reportNumber','')}  |  Engineering Axis (Pvt.) Ltd.")
    run.font.size = Pt(8)
    run.font.color.rgb = RGBColor(0x80, 0x80, 0x80)

    doc.save(output_path)
    return output_path
