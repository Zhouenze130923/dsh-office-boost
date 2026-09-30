"""Small PDF inspection and page utility for the Office Boost skill."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "vendor" / "python"))
import pymupdf


def page_numbers(spec: str, count: int) -> list[int]:
    result = []
    for part in spec.split(","):
        bounds = part.strip().split("-", 1)
        first = int(bounds[0])
        last = int(bounds[1]) if len(bounds) == 2 else first
        if first < 1 or last < first or last > count:
            raise ValueError(f"page range {part!r} is outside 1-{count}")
        result.extend(range(first - 1, last))
    return result


def open_pdf(path: str):
    doc = pymupdf.open(path)
    if doc.needs_pass:
        doc.close()
        raise ValueError("encrypted PDF requires a password; ask the user")
    return doc


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    info = sub.add_parser("info")
    info.add_argument("input")
    extract = sub.add_parser("extract")
    extract.add_argument("input")
    extract.add_argument("--output", required=True)
    render = sub.add_parser("render")
    render.add_argument("input")
    render.add_argument("--output-dir", required=True)
    render.add_argument("--pages", required=True)
    render.add_argument("--dpi", type=int, default=144)
    merge = sub.add_parser("merge")
    merge.add_argument("output")
    merge.add_argument("inputs", nargs="+", help="at least two input PDFs")
    pages = sub.add_parser("pages")
    pages.add_argument("input")
    pages.add_argument("--output", required=True)
    pages.add_argument("--range", required=True)
    args = parser.parse_args()

    if args.command == "merge":
        if len(args.inputs) < 2:
            parser.error("merge needs at least two input PDFs")
        target = Path(args.output).resolve()
        if target in [Path(item).resolve() for item in args.inputs]:
            parser.error("output must differ from every input")
        output = pymupdf.open()
        for path in args.inputs:
            with open_pdf(path) as source:
                output.insert_pdf(source)
        output.save(target)
        print(json.dumps({"output": str(target), "pages": len(output)}))
        return

    with open_pdf(args.input) as doc:
        if args.command == "info":
            print(json.dumps({
                "pages": len(doc),
                "metadata": doc.metadata,
                "page_sizes": [[round(page.rect.width, 2), round(page.rect.height, 2)] for page in doc],
                "text_characters": [len(page.get_text()) for page in doc],
            }, ensure_ascii=False))
        elif args.command == "extract":
            output = Path(args.output)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text("\n\n".join(page.get_text() for page in doc), encoding="utf-8")
            print(json.dumps({"output": str(output.resolve()), "pages": len(doc)}))
        elif args.command == "render":
            if args.dpi < 36 or args.dpi > 300:
                parser.error("dpi must be between 36 and 300")
            output_dir = Path(args.output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)
            rendered = []
            for index in page_numbers(args.pages, len(doc)):
                path = output_dir / f"page-{index + 1}.png"
                doc[index].get_pixmap(dpi=args.dpi, alpha=False).save(path)
                rendered.append(str(path.resolve()))
            print(json.dumps({"images": rendered}))
        elif args.command == "pages":
            target = Path(args.output).resolve()
            if target == Path(args.input).resolve():
                parser.error("output must differ from input")
            selected = page_numbers(args.range, len(doc))
            output = pymupdf.open()
            for index in selected:
                output.insert_pdf(doc, from_page=index, to_page=index)
            output.save(target)
            print(json.dumps({"output": str(target), "pages": len(output)}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError) as error:
        sys.exit(str(error))
