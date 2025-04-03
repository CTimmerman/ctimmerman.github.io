"""Stop messing up my LLM inference by nodding off, Windows 11. CT 2024-12-19."""

import time

from wakepy import keep

print("Staying up.")

with keep.running():  # presenting() to also keep on display.
    while True:
        time.sleep(60)

print("Done.")
