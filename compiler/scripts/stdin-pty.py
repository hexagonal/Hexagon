"""Run emitted Stdio ESM with a PTY as its stdin, and type into it.

Types two lines, then the end of input (Ctrl-D at the start of a line), then a
third line and the end of input again, pausing between them so each arrives
while the program waits. Prints what the program wrote to stdout, and exits
with its status.
"""

import os
import pty
import subprocess
import sys
import time


def main():
    command = sys.argv[1:]
    master, slave = pty.openpty()
    child = subprocess.Popen(command, stdin=slave, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE)
    os.close(slave)
    for text in (b"first line\n", b"second\n", b"\x04", b"after\n", b"\x04"):
        time.sleep(0.3)
        os.write(master, text)
    try:
        stdout, stderr = child.communicate(timeout=30)
    except subprocess.TimeoutExpired:
        child.kill()
        raise TimeoutError("the program reading the PTY did not finish")
    finally:
        os.close(master)
    sys.stdout.buffer.write(stdout)
    sys.stderr.buffer.write(stderr)
    return child.returncode


if __name__ == "__main__":
    sys.exit(main())
