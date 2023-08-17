"Autoclicker by Cees Timmerman, 2023-06-13."

import time
import keyboard, mouse  # pip install keyboard mouse

click = False
hotkey = "Alt + C"

print(__doc__, hotkey, "to toggle. Ctrl + C to exit.")

def toggle_clicker():
  global click
  click = not click
  print("Clicking", click)

keyboard.add_hotkey(hotkey, toggle_clicker)

try:
  while True:
    if click: mouse.click()
    time.sleep(0.001)
except KeyboardInterrupt:
  pass