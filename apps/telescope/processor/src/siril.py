"""Siril in console mode: `siril-cli -s <script>`, one script per step, at the lowest CPU and I/O
priority (nice 19, ionice idle) so the live service and the rest of the node always come first.

Every script starts with the memory cap (`core.mem_mode=1`, `core.mem_amount`: Siril sizes its
stacking blocks from it instead of from /proc/meminfo, which shows the whole node, not the
container's limit) and the thread count. Offline (`-o`) unless the step needs the online
catalogues (photometric colour calibration). Its `log:` lines go to the job log; `progress:` lines
(`progress: <text>, 45.00%`) to the caller.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
from collections.abc import Callable

log = logging.getLogger("siril")

SIRIL = os.environ.get("SIRIL", "/opt/siril/AppRun")
MEM_GB = float(os.environ.get("SIRIL_MEM_GB", "3"))
THREADS = int(os.environ.get("SIRIL_THREADS", "4"))
PROGRESS = re.compile(r"^progress: (.*?),? *([\d.]+)%$")
# Lines left out of the job log: file by file I/O, per-frame registration matrices (the summary
# stays), start-up chatter, Siril's Python environment (unused here).
NOISE = ("HDU 1:", "Reading FITS:", "Saving FITS:", "Running command:", "Findstar: processing for channel",
         "Reading sequence", "Writing sequence", "Supported file types:", "Color management", "JPEG ICC",
         "Parallel processing enabled", "Setting CWD", "Welcome to siril", "OK! This script is compatible",
         "Matching stars in image", "Initial pair matches", "Pair matches after fitting", "Inliers:", "scaleX:",
         "scaleY:", "scale:", "rotation:", "dx:", "dy:", "FWHM:", "roundness:", "Preparing python virtual",
         "Checking the python module", "Python module is", "Installing / updating python", "Scripts repository",
         "Virtual environment health check", "Failed to initialize Python virtual environment")


class SirilError(Exception):
    pass


_version: str | None = None


def version() -> str:
    global _version
    if _version is None:
        try:
            out = subprocess.run([SIRIL, "siril-cli", "--version"], capture_output=True, text=True, timeout=60).stdout
            _version = next((line.split()[-1] for line in out.splitlines() if line.startswith("siril ")), "unknown")
        except (OSError, subprocess.SubprocessError):
            _version = "unknown"
    return _version


def run(lines: list[str], workdir: str, name: str, on_log: Callable[[str], None],
        on_progress: Callable[[str, float], None] | None = None, online: bool = False,
        force_16bit: bool = False) -> tuple[list[str], int]:
    """Run one script in `workdir`; returns its log lines and Siril's peak resident memory (bytes),
    raises SirilError when it fails."""
    script = [
        "requires 1.4.0",
        "set core.mem_mode=1",
        f"set core.mem_amount={MEM_GB:g}",
        f"set core.force_16bit={'true' if force_16bit else 'false'}",
        f"set core.swap_dir={workdir}",
        "set core.check_updates=false",
        "set gui.use_scripts_repository=false",
        "set gui.auto_update_scripts=false",
        "set gui.auto_update_spcc=false",
        f"setcpu {THREADS}",
        *lines,
    ]
    path = os.path.join(workdir, f"{name}.ssf")
    with open(path, "w") as f:
        f.write("\n".join(script) + "\n")
    cmd = ["ionice", "-c", "3", "nice", "-n", "19", SIRIL, "siril-cli", *([] if online else ["-o"]), "-d", workdir, "-s", path]
    kept: list[str] = []
    errors: list[str] = []
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", bufsize=1,
                            cwd=workdir)
    assert proc.stdout is not None
    for raw in proc.stdout:
        line = raw.rstrip()
        if line.startswith("progress: "):
            m = PROGRESS.match(line)
            if m and on_progress:
                on_progress(m[1], float(m[2]))
            continue
        if not line.startswith("log: "):
            continue
        text = line[5:]
        if text.startswith(NOISE):
            continue
        kept.append(text)
        on_log(text)
        if text.startswith(("Error", "error:")) or "failed" in text.lower() and "0 failed" not in text:
            errors.append(text)
    # Siril's peak resident memory (ionice and nice exec into it: one process).
    _, status, usage = os.wait4(proc.pid, 0)
    code = os.waitstatus_to_exitcode(status)
    proc.returncode = code
    if code != 0 or not any(t.startswith("Script execution finished successfully") for t in kept):
        raise SirilError(f"{name}: " + ("; ".join(errors[-3:]) or (kept[-1] if kept else f"siril exited with {code}")))
    return kept, usage.ru_maxrss * 1024
