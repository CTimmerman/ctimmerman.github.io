"""Autoclicker by Cees Timmerman, 20230613 - 20260831.
"""

import platform
import time
import mouse  # pip install mouse

HOTKEY = "Alt + C"
click = False
target = (0, 0)

def toggle_clicker():
  global click, target
  click = not click
  if click:
    target = mouse.get_position()
  print("Clicking", target, click)

print(__doc__, HOTKEY, "to toggle. Ctrl + C to exit.")


if platform.system() == "Windows":
  from global_hotkeys import *  # pip install global-hotkeys
  bindings = [[HOTKEY, toggle_clicker, None],]
  register_hotkeys(bindings)
  start_checking_hotkeys()
else:
  import keyboard
  keyboard.add_hotkey(HOTKEY, toggle_clicker)

try:
  while True:
    p = mouse.get_position()
    if click and (abs(target[0] - p[0]) > 40 or abs(target[1] - p[1]) > 40):
      toggle_clicker()
    if click:
      mouse.move(*target, True)
      mouse.click()
    time.sleep(0.01)  # 0.0001 might be related to Windows 11 GameInput BSOD.
except KeyboardInterrupt:
  pass
