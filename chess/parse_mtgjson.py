"""Streaming search, by Cees Timmerman 2023-11-27."""
import gzip
import io
import json
import re
import requests
import shutil


def download_file():
    print(f"Downloading {remote_path}...", end="")
    with requests.get(
        remote_path, headers=headers, stream=True, verify=False, allow_redirects=True
    ) as z:
        with open(local_filename, "wb") as f:
            shutil.copyfileobj(z.raw, f)
    print("Done.")


card_pattern = "{\"artist\":.*?\"uuid\":[^}]+?}"

count = 0


def get_cards(path: str) -> str: # type: ignore
    global count
    if ".gz" in path:
        path = gzip.GzipFile(path)
    f = io.open(path, "r", encoding="utf8")
    with f:
        chew: str = ""
        i: int = 0
        while bite := f.read(12 * 1024):
            i += 1
            chew += bite
            if len(chew) > 4e5:
                print("Chewing", len(chew))
                print(f"===== Bite {i}:", bite[:100])
                print("========")
                print(chew)
                print("/=======", len(chew), re.search(card_pattern, chew, re.DOTALL))
                print("WTF.", count, re.findall(card_pattern, chew), type(chew))
                open("wtf.json", "w").write(chew)
                breakpoint()
            while match := re.search(card_pattern, chew, re.DOTALL):
                chew = chew[match.end() :]
                count += 1
                # print(count, 'cards. chewing', len(chew))
                yield match.group(0)


def filter_fun(s: str) -> bool:
    # json = json.loads(s)
    # print("===:")
    # print(s)
    # print("/===")
    found = "Blex" in s
    if found:
        m = re.search('"name".*?",', s)
        print("Found!", m.group(0))
    return found


if __name__ == "__main__":
    # remote_path = "https://mtgjson.com/api/v5/AllPrintings.json.gz"
    remote_path = "https://mtgjson.com/api/v5/AllPrintingsCSVFiles.zip"
    local_path = "AllPrintings.json"
    # local_path = "mtg_sample.json"
    for i, card in enumerate(filter(filter_fun, get_cards(local_path))):
        print("Card", i + 1, card, "/CARD")
