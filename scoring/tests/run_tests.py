"""
מריץ מקומי לטסטים כשאין pytest מותקן (סביבה מנותקת).
בפרודקשן פשוט הריצו `pytest -q` — הטסטים כתובים בתחביר pytest תקני.
"""
from __future__ import annotations

import contextlib
import sys
import traceback
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


# --- שים pytest מינימלי ------------------------------------------------------
def _make_pytest_stub() -> types.ModuleType:
    mod = types.ModuleType("pytest")

    @contextlib.contextmanager
    def raises(exc):
        try:
            yield
        except exc:
            return
        raise AssertionError(f"ציפינו לחריגה {exc.__name__} ולא נזרקה")

    class _Mark:
        @staticmethod
        def parametrize(argnames, argvalues):
            names = [a.strip() for a in argnames.split(",")]

            def deco(fn):
                fn._params = (names, argvalues)
                return fn
            return deco

    mod.raises = raises
    mod.mark = _Mark
    return mod


sys.modules.setdefault("pytest", _make_pytest_stub())

import test_engine  # noqa: E402


def main() -> int:
    passed = failed = 0
    for name in sorted(dir(test_engine)):
        if not name.startswith("test_"):
            continue
        fn = getattr(test_engine, name)
        cases = [()]
        if hasattr(fn, "_params"):
            _, values = fn._params
            cases = [v if isinstance(v, tuple) else (v,) for v in values]
        for args in cases:
            label = f"{name}{args if args else ''}"
            try:
                fn(*args)
                passed += 1
                print(f"  ✓ {label}")
            except Exception:
                failed += 1
                print(f"  ✗ {label}")
                traceback.print_exc()
    print(f"\n{passed} עברו, {failed} נכשלו")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
