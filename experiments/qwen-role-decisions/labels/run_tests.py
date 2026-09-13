"""Run test_* functions in the named modules. Usage: python3 -B labels/run_tests.py labels.test_x [...]"""
import importlib, sys, traceback
sys.path.insert(0, ".")
ok = fail = 0
for mod in sys.argv[1:]:
    m = importlib.import_module(mod)
    for name in sorted(n for n in dir(m) if n.startswith("test_")):
        try:
            getattr(m, name)(); ok += 1; print("ok  ", mod, name)
        except Exception:
            fail += 1; print("FAIL", mod, name); traceback.print_exc(limit=4)
print(f"passed={ok} failed={fail}")
sys.exit(1 if fail else 0)
