#!/usr/bin/env python3
"""Wrap the artifact fragment into a standalone page for GitHub Pages.

artifact/10pax.html is authored for the Claude Artifact tool, which supplies the
<!doctype>/<head>/<body> skeleton at publish time. GitHub Pages serves raw files, so
this rebuilds that skeleton around the same source. Run it after editing the artifact:

    python3 build.py
"""
import re
from pathlib import Path

SRC = Path("artifact/10pax.html")
OUT = Path("index.html")

FAVICON = (
    "data:image/svg+xml,"
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E"
    "%3Ctext y='.9em' font-size='90'%3E%F0%9F%97%93%EF%B8%8F%3C/text%3E%3C/svg%3E"
)

def main() -> None:
    body = SRC.read_text(encoding="utf-8")

    # The fragment carries its own <title>; it belongs in <head>.
    m = re.search(r"<title>(.*?)</title>\s*", body, re.S)
    title = m.group(1).strip() if m else "10 Pax"
    if m:
        body = body[: m.start()] + body[m.end() :]

    # Mirrors the reset the Artifact viewer injects, so both render identically.
    OUT.write_text(
        "<!doctype html>\n"
        '<html lang="en">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{title}</title>\n"
        '<meta name="description" content="Find the one hour your whole group is actually free.">\n'
        f'<link rel="icon" href="{FAVICON}">\n'
        # Loaded before the app so window.PAX_FIREBASE exists when it boots.
        # Missing or blank config is fine: the app falls back to link + codes.
        '<script src="firebase-config.js"></script>\n'
        "<style>\n"
        "  :root { color-scheme: light dark; }\n"
        "  body { margin: 0; font: 14px system-ui, sans-serif; background: #fafaf9; }\n"
        "  img { max-width: 100%; }\n"
        "  [hidden] { display: none !important; }\n"
        "</style>\n"
        "</head>\n<body>\n"
        f"{body.strip()}\n"
        "</body>\n</html>\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes) from {SRC}")

if __name__ == "__main__":
    main()
