#!/usr/bin/env python3
"""Wrap the artifact fragment into standalone pages.

artifact/10pax.html is authored for the Claude Artifact tool, which supplies the
<!doctype>/<head>/<body> skeleton at publish time. Everything else serves raw
files, so this rebuilds that skeleton around the same source. Two outputs:

    public/index.html   served by the Worker; the API is same-origin at /api
    index.html          the GitHub Pages mirror; pax-api.js points it at the Worker

Run after editing the artifact:  python3 build.py
"""
import re
from pathlib import Path

SRC = Path("artifact/10pax.html")
OUTPUTS = [
    (Path("public/index.html"), ""),
    (Path("index.html"), '<script src="pax-api.js"></script>\n'),
]

FAVICON = (
    "data:image/svg+xml,"
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E"
    "%3Ctext y='.9em' font-size='90'%3E%F0%9F%97%93%EF%B8%8F%3C/text%3E%3C/svg%3E"
)

RESET = """  :root { color-scheme: light dark; }
  body { margin: 0; font: 14px system-ui, sans-serif; background: #fafaf9; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }"""


def main() -> None:
    body = SRC.read_text(encoding="utf-8")

    # The fragment carries its own <title>; it belongs in <head>.
    m = re.search(r"<title>(.*?)</title>\s*", body, re.S)
    title = m.group(1).strip() if m else "10 Pax"
    if m:
        body = body[: m.start()] + body[m.end():]

    for path, extra_head in OUTPUTS:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "<!doctype html>\n"
            '<html lang="en">\n<head>\n'
            '<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            f"<title>{title}</title>\n"
            '<meta name="description" content="Find the one hour your whole group is actually free.">\n'
            f'<link rel="icon" href="{FAVICON}">\n'
            f"{extra_head}"
            f"<style>\n{RESET}\n</style>\n"
            "</head>\n<body>\n"
            f"{body.strip()}\n"
            "</body>\n</html>\n",
            encoding="utf-8",
        )
        print(f"wrote {path} ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
