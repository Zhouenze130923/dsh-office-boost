---
name: office-pdf
description: Read, create, edit, combine, and preview PDF documents. Use when a PDF is an input or requested deliverable.
---

# PDF work in Harness

Use the installed Python from the workspace-dependencies tool. The loaded skill supplies the absolute path to `pdf_tool.py`. On first use, the tool downloads a checksum-verified PyMuPDF runtime into the local DSH cache and inserts it into Python's import path. Keep inputs, scripts, previews, and final files in the task workspace. Never overwrite an input PDF unless the user explicitly asks for it.

## Read and inspect

Run `python pdf_tool.py info input.pdf` for page count, page sizes, metadata, encryption, and text coverage. Run `python pdf_tool.py extract input.pdf --output extracted.txt` to read the text. Text extraction may be empty for scanned pages; then render the relevant pages and inspect the images if image input is available. Do not claim an image-only PDF has been read from an empty text extraction.

## Create and edit

For a new report or letter, use `office-docx` to author a source DOCX, run its structural and visual checks, then use its bundled LibreOffice Kit `convert` command to create the final PDF. For slide-based PDFs, use `office-pptx`; for spreadsheet exports, use `office-xlsx`. This preserves an editable source alongside the PDF. If the user asks to edit an existing PDF, inspect it first. Use PyMuPDF for page operations, annotations, text extraction, and targeted overlays; avoid pretending that arbitrary PDF text can be reflowed like a Word document. Save edits to a new PDF and reopen it for verification.

`pdf_tool.py merge output.pdf input1.pdf input2.pdf ...` combines files in order. `pdf_tool.py pages input.pdf --output selected.pdf --range 1,3-5` extracts selected pages. Use a short Python script with `import pymupdf` and the supplied package directory when an edit needs an operation the helper does not expose.

## Preview and verify

Harness's right sidebar document preview displays PDF and Office files. For page-level layout checks, run `python pdf_tool.py render input.pdf --output-dir preview --pages 1,3-5 --dpi 144`, then inspect the resulting PNGs. Verify page count, required text, figures, tables, cropping, and readability. The helper writes a JSON summary for each operation. For an image-only PDF, preview every relevant page. Present the final PDF using the available deliverables tool, or give its workspace path if that tool is unavailable. Mention any page or feature that could not be inspected.
