"""Run emitted Stdio ESM with stdout/stderr attached to separate PTYs.

Disable the terminal driver's output processing so the caller can compare the
actual bytes supplied by the module, without platform-specific LF conversion.
"""

import errno
import os
import pty
import select
import subprocess
import sys
import termios
import time


def raw_output(slave):
    attributes = termios.tcgetattr(slave)
    attributes[1] &= ~termios.OPOST
    termios.tcsetattr(slave, termios.TCSANOW, attributes)


def main():
    stdout_path, stderr_path, *command = sys.argv[1:]
    out_master, out_slave = pty.openpty()
    err_master, err_slave = pty.openpty()
    raw_output(out_slave)
    raw_output(err_slave)
    child = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                             stdout=out_slave, stderr=err_slave)
    os.close(out_slave)
    os.close(err_slave)
    chunks = {out_master: [], err_master: []}
    active = set(chunks)
    deadline = time.monotonic() + 30
    while active:
        if time.monotonic() >= deadline:
            child.kill()
            raise TimeoutError("PTY writer did not finish")
        ready, _, _ = select.select(list(active), [], [], 0.1)
        for master in ready:
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                chunk = b""
            if chunk:
                chunks[master].append(chunk)
            else:
                active.remove(master)
                os.close(master)
    with open(stdout_path, "wb") as output:
        output.write(b"".join(chunks[out_master]))
    with open(stderr_path, "wb") as output:
        output.write(b"".join(chunks[err_master]))
    return child.wait(timeout=1)


if __name__ == "__main__":
    sys.exit(main())
