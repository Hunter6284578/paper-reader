#!/usr/bin/env python3
"""Docling-based PDF parser for the Paper Reader app.

Converts a born-digital academic PDF into structured, reading-ordered blocks.
OCR is deliberately disabled -- only digital PDFs with text layers are accepted.
Visual elements (figures, tables, algorithms, formulas) are cropped from
high-resolution page renders.

Usage:
    python docling_parser.py <pdf_path> <output_dir>

Outputs JSON to stdout with status, blocks, visualBlocks, and pageImages.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import traceback
from pathlib import Path

import fitz  # PyMuPDF for page rendering and cropping
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
from docling.document_converter import DocumentConverter, PdfFormatOption


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def extract_item_text(item, document) -> str:
    """Best-effort text extraction for a Docling document item."""
    # Direct .text attribute
    text = getattr(item, "text", None)
    if isinstance(text, str) and text.strip():
        return re.sub(r"\s+", " ", text).strip()
    # Markdown export (tables, etc.)
    exporter = getattr(item, "export_to_markdown", None)
    if callable(exporter):
        try:
            value = exporter(document)
            if value:
                return str(value).strip()
        except Exception:
            pass
    # HTML export fallback for tables
    html_exporter = getattr(item, "export_to_html", None)
    if callable(html_exporter):
        try:
            value = html_exporter(document)
            if value:
                return str(value).strip()
        except Exception:
            pass
    return ""


def extract_item_latex(item) -> str | None:
    """Try to get LaTeX source from a formula item."""
    # Docling formula items may expose .orig or .text with LaTeX
    for attr in ("orig", "latex", "text"):
        val = getattr(item, attr, None)
        if isinstance(val, str) and val.strip():
            # Heuristic: if it looks like LaTeX (contains backslash commands)
            if "\\" in val or "$" in val or attr == "latex":
                return val.strip()
    return None


def get_top_left_bbox(prov, page_height: float) -> list[float] | None:
    """Convert a Docling provenance bbox to top-left origin [x1, y1, x2, y2]."""
    bbox = getattr(prov, "bbox", None)
    if bbox is None:
        return None
    try:
        converted = bbox.to_top_left_origin(page_height=page_height)
        return [float(converted.l), float(converted.t), float(converted.r), float(converted.b)]
    except Exception:
        l, t, r, b = (float(bbox.l), float(bbox.t), float(bbox.r), float(bbox.b))
        if t > b:  # bottom-left PDF coordinates
            return [l, page_height - t, r, page_height - b]
        return [l, t, r, b]


def crop_visual_from_page(pdf, page_no: int, bbox: list[float], destination: Path, dpi: int = 300) -> None:
    """Crop a visual element from the page at high resolution and save as PNG."""
    page = pdf[page_no - 1]
    pad = 4  # pixels of padding
    scale = dpi / 72.0
    rect = fitz.Rect(
        max(0, bbox[0] - pad / scale),
        max(0, bbox[1] - pad / scale),
        min(page.rect.width, bbox[2] + pad / scale),
        min(page.rect.height, bbox[3] + pad / scale),
    )
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=rect, alpha=False)
    destination.parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(destination))


def render_page_image(pdf, page_index: int, output_dir: Path, dpi: int = 300) -> dict:
    """Render a full page as high-resolution PNG (300 DPI)."""
    page = pdf[page_index]
    scale = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    file_name = f"page_{page_index + 1}.png"
    file_path = output_dir / file_name
    pix.save(str(file_path))
    return {
        "pageNumber": page_index + 1,
        "fileName": file_name,
        "width": pix.width,
        "height": pix.height,
        "fileSize": file_path.stat().st_size,
    }


def detect_scanned_pdf(pdf) -> bool:
    """Return True if the PDF appears to be scanned (no extractable text)."""
    total_text = 0
    text_pages = 0
    for page in pdf:
        page_text = page.get_text("text").strip()
        total_text += len(page_text)
        if len(page_text) >= 20:
            text_pages += 1
    # Consider it scanned if very little text is extractable
    if total_text < 100 or text_pages < max(1, len(pdf) // 3):
        return True
    return False


# ---------------------------------------------------------------------------
# Main parsing logic
# ---------------------------------------------------------------------------

def parse_pdf(pdf_path: str, output_dir: str) -> dict:
    """Parse a PDF and return structured output."""
    pdf_path_obj = Path(pdf_path)
    output_dir_obj = Path(output_dir)
    output_dir_obj.mkdir(parents=True, exist_ok=True)
    visual_dir = output_dir_obj / "blocks"
    visual_dir.mkdir(parents=True, exist_ok=True)

    # Open with PyMuPDF for page rendering and scan detection
    pdf = fitz.open(pdf_path_obj)
    page_count = len(pdf)

    # Scanned PDF detection
    if detect_scanned_pdf(pdf):
        pdf.close()
        return {
            "status": "error",
            "error": "UNSUPPORTED_SCANNED_PDF: This PDF appears to be a scanned document with no extractable text layer. Only digital/born-digital PDFs are supported.",
            "title": None,
            "pageCount": page_count,
            "blocks": [],
            "visualBlocks": [],
            "pageImages": [],
        }

    # Render full-page images at 300 DPI (PNG for lossless quality)
    page_images = []
    for i in range(page_count):
        page_img = render_page_image(pdf, i, output_dir_obj, dpi=300)
        page_images.append(page_img)
        if (i + 1) % 5 == 0 or (i + 1) == page_count:
            print(f"[docling_parser] Page image render: {i + 1}/{page_count}", file=sys.stderr)

    # Configure Docling pipeline -- NO OCR
    options = PdfPipelineOptions()
    options.do_ocr = False
    options.do_table_structure = True
    options.table_structure_options.mode = TableFormerMode.ACCURATE
    options.generate_picture_images = True

    converter = DocumentConverter(format_options={
        InputFormat.PDF: PdfFormatOption(pipeline_options=options),
    })

    print(f"[docling_parser] Starting Docling conversion...", file=sys.stderr)
    result = converter.convert(str(pdf_path_obj))
    document = result.document
    print(f"[docling_parser] Docling conversion complete.", file=sys.stderr)

    # Map Docling labels to our block types
    visual_label_map = {
        "picture": "figure",
        "table": "table",
        "formula": "formula",
        "code": "algorithm",
    }
    ignored_labels = {"page_header", "page_footer", "footnote", "page_number"}

    blocks = []
    visual_blocks = []
    section = "Full Text"
    title = None
    reading_order = 0

    for item, level in document.iterate_items():
        raw_label = str(getattr(item, "label", "text"))
        # Labels may be namespaced like "DocItemLabel.TEXT" -- normalize
        label = raw_label.split(".")[-1].lower() if "." in raw_label else raw_label.lower()

        if label in ignored_labels:
            continue

        text = extract_item_text(item, document)
        provs = getattr(item, "prov", None) or []
        prov = provs[0] if provs else None
        page_no = int(getattr(prov, "page_no", 1)) if prov else None
        page_height = float(pdf[page_no - 1].rect.height) if page_no and page_no <= page_count else 0
        bbox = get_top_left_bbox(prov, page_height) if prov and page_no else None

        # --- Title detection ---
        if label in ("title", "document_title"):
            if text:
                title = text
                section = text
                blocks.append({
                    "type": "section",
                    "content": text,
                    "sectionTitle": text,
                    "pageNumber": page_no,
                    "readingOrder": reading_order,
                    "bbox": {"page": page_no, "x1": bbox[0], "y1": bbox[1], "x2": bbox[2], "y2": bbox[3]} if bbox else None,
                    "latex": None,
                })
                reading_order += 1
            continue

        # --- Section headers ---
        if label in ("section_header", "section_title", "heading"):
            if text:
                section = text
                blocks.append({
                    "type": "section",
                    "content": text,
                    "sectionTitle": text,
                    "pageNumber": page_no,
                    "readingOrder": reading_order,
                    "bbox": {"page": page_no, "x1": bbox[0], "y1": bbox[1], "x2": bbox[2], "y2": bbox[3]} if bbox else None,
                    "latex": None,
                })
                reading_order += 1
            continue

        # --- Visual elements: figure, table, algorithm, formula ---
        visual_type = visual_label_map.get(label)
        if visual_type and bbox and page_no:
            block_index = len(blocks)
            asset_name = f"block_{block_index}.png"
            crop_visual_from_page(pdf, page_no, bbox, visual_dir / asset_name, dpi=300)

            latex = extract_item_latex(item) if visual_type == "formula" else None

            blocks.append({
                "type": visual_type,
                "content": text,
                "sectionTitle": section,
                "pageNumber": page_no,
                "readingOrder": reading_order,
                "bbox": {"page": page_no, "x1": bbox[0], "y1": bbox[1], "x2": bbox[2], "y2": bbox[3]},
                "latex": latex,
                "assetPath": f"blocks/{asset_name}",
            })
            visual_blocks.append({
                "blockIndex": block_index,
                "type": visual_type,
                "pageNumber": page_no,
                "bbox": {"page": page_no, "x1": bbox[0], "y1": bbox[1], "x2": bbox[2], "y2": bbox[3]},
                "assetPath": f"blocks/{asset_name}",
            })
            reading_order += 1
            continue

        # --- Text, captions, and other content ---
        if text and len(text) >= 2:
            block_type = "text"
            if label == "caption":
                block_type = "caption"
            elif label == "list_item":
                block_type = "text"

            # Detect algorithm captions by pattern
            if re.match(r"^(algorithm|alg\.?)\s+\d+", text, re.I):
                block_type = "caption"

            blocks.append({
                "type": block_type,
                "content": text,
                "sectionTitle": section,
                "pageNumber": page_no,
                "readingOrder": reading_order,
                "bbox": {"page": page_no, "x1": bbox[0], "y1": bbox[1], "x2": bbox[2], "y2": bbox[3]} if bbox else None,
                "latex": None,
            })
            reading_order += 1

    pdf.close()

    # Validate that we extracted meaningful content
    text_content_len = sum(
        len(block.get("content") or "")
        for block in blocks
        if block["type"] in ("text", "section", "caption")
    )
    if text_content_len < 100:
        return {
            "status": "error",
            "error": "PDF_LAYOUT_EMPTY: Docling conversion produced no meaningful text content. The PDF may use an unsupported layout.",
            "title": title,
            "pageCount": page_count,
            "blocks": [],
            "visualBlocks": [],
            "pageImages": page_images,
        }

    print(f"[docling_parser] Parsed {len(blocks)} blocks ({len(visual_blocks)} visual), {len(page_images)} pages", file=sys.stderr)

    return {
        "status": "success",
        "error": None,
        "title": title,
        "pageCount": page_count,
        "blocks": blocks,
        "visualBlocks": visual_blocks,
        "pageImages": page_images,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Parse a PDF with Docling")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("output_dir", help="Directory for output images and assets")
    args = parser.parse_args()

    pdf_path = args.pdf_path
    output_dir = args.output_dir

    if not Path(pdf_path).exists():
        result = {
            "status": "error",
            "error": f"PDF file not found: {pdf_path}",
            "title": None,
            "pageCount": 0,
            "blocks": [],
            "visualBlocks": [],
            "pageImages": [],
        }
        print(json.dumps(result, ensure_ascii=False))
        return 1

    try:
        result = parse_pdf(pdf_path, output_dir)
        # Output JSON to stdout for the Node.js parent process
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["status"] == "success" else 1
    except Exception as exc:
        error_msg = str(exc)
        tb = traceback.format_exc()
        print(f"[docling_parser] Fatal error: {error_msg}\n{tb}", file=sys.stderr)
        result = {
            "status": "error",
            "error": error_msg,
            "title": None,
            "pageCount": 0,
            "blocks": [],
            "visualBlocks": [],
            "pageImages": [],
        }
        print(json.dumps(result, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
