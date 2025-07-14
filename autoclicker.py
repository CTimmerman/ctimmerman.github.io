"Autoclicker by Cees Timmerman, 2023-06-13."

import time
import keyboard, mouse  # pip install keyboard mouse

click = False
hotkey = "Alt + C"
target = (0, 0)

def toggle_clicker():
  global click, target
  click = not click
  if click:
    target = mouse.get_position()
  print("Clicking", target, click)

keyboard.add_hotkey(hotkey, toggle_clicker)
print(__doc__, hotkey, "to toggle. Ctrl + C to exit.")

try:
  while True:
    p = mouse.get_position()
    if click and (abs(target[0] - p[0]) > 40 or abs(target[1] - p[1]) > 40):
      toggle_clicker()
    if click:
      mouse.move(*target, True)
      mouse.click()
    time.sleep(0.001)  # 0.0001 might be related to Windows 11 GameInput BSOD.
except KeyboardInterrupt:
  pass
