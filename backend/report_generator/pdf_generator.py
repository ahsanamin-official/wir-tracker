"""
pdf_generator.py — converts a generated .docx into .pdf using a local
LibreOffice (soffice) headless install. This avoids re-implementing
layout logic in ReportLab and guarantees the PDF matches the DOCX
exactly. If LibreOffice is not installed, generation fails with a
clear error (surfaced by the /api/generate-report route).
"""
import subprocess
import shutil
import os


def _soffice_binary():
    for name in ('soffice', 'libreoffice'):
        path = shutil.which(name)
        if path:
            return path
    return None


def docx_to_pdf(docx_path, output_dir):
    binary = _soffice_binary()
    if not binary:
        return False
    try:
        subprocess.run(
            [binary, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', output_dir, docx_path],
            check=True, timeout=120, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False
    pdf_name = os.path.splitext(os.path.basename(docx_path))[0] + '.pdf'
    return os.path.exists(os.path.join(output_dir, pdf_name))
