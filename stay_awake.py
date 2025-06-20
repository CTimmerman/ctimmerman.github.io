"""Stop messing up my LLM inference by nodding off, Windows 11. CT 2024-12-19 to 2025-06-20."""

import platform, subprocess, time

# In case waiting for lock isn't enough.
# import mouse
# p = mouse.get_position()
# mouse.move(p, True)
from wakepy import keep


def screen_locked() -> bool:
    match platform.system():
        case "Darwin":
            import Quartz  # type: ignore  # pylint: disable=import-outside-toplevel

            d = Quartz.CGSessionCopyCurrentDictionary()
            return bool(d.get("CGSSessionScreenIsLocked", 0))
        case "Linux":
            # Assume systemd.
            return b"yes" in subprocess.check_output(
                ["loginctl", "show-session", "-p", "IdleHint"]
            )
        case "Windows":
            return b"LogonUI" in subprocess.check_output("tasklist")
    return False


if __name__ == "__main__":
    print("Staying up.")
    fun = keep.presenting
    while True:
        with fun():
            while True:
                time.sleep(20)
                old_fun = fun
                if screen_locked():
                    fun = keep.running
                else:
                    fun = keep.presenting
                if old_fun != fun:
                    print(
                        f"Screen {'un' if fun.__name__ == 'presenting' else ''}locked on {time.ctime()}. Keep {fun.__name__}"
                    )
                    break
