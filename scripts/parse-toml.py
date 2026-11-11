"""Parse TOML with Python 3.11+'s standard library; never log source values."""
import json
import sys

try:
    import tomllib
except ImportError:
    sys.exit("TOML conversion requires Python 3.11 or later.")

try:
    data = tomllib.loads(sys.stdin.buffer.read().decode("utf-8"))
    sys.stdout.write(json.dumps(data, ensure_ascii=True, allow_nan=False))
except (tomllib.TOMLDecodeError, UnicodeDecodeError, ValueError, TypeError):
    sys.exit("Invalid TOML or unsupported value type in short-link configuration.")
