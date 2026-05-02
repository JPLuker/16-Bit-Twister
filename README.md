# 16-Bit Twister

> **Twister for your fingers.** Two retro games side-by-side, one keyboard, and **randomized keybinds** every round. Can you out-contort your opponent before the timer hits zero?


> 🍴 Forked from [8-Bit Twister](https://github.com/segaboy/8-Bit-Twister) by segaboy. This fork expands system support beyond NES.

![16-Bit Twister gameplay screenshot](assets/screenshot.png)
---

## Why it's awesome

* 🎮 **Two emulators at once** — same ROM boots in both panes for a fair race.
* 🎲 **New keybind chaos each round** — 8 random keys per player, shown under each screen.
* 🕐 **Match timer + end screen** — race the clock; decide the winner on score/progress.
* 🧲 **Drag & drop** — drop a ROM file directly in your browser to start instantly (click-to-choose also works).
* 🧱 **100% client-side** — no server, no build tools; host anywhere (GitHub Pages, Nginx, etc.).

> Designed for parties, meetups, and "you've got five minutes, prove it" showdowns.

---

## How to play (quick start)

1. **Open the site** (local file or hosted page).
2. **Drop a ROM** onto the big dropzone (or click it to choose).
3. Review your **random key legends** under each screen.
4. Hit **Start Match** → timer begins.
5. At **time up**, compare progress/score and crown your champion. 👑

> Legal note: Use homebrew or ROMs you're legally allowed to use. This project ships without ROMs.

---

## Controls (by default)

* **Randomized per round** — each player gets 8 unique keys:
  * D-Pad: Up / Down / Left / Right
  * **A**, **B**, **Start**, **Select**
* The current keys for each player are printed in the legend beneath each emulator.

---

## Local setup

No tooling needed. Just open `index.html`, or serve the folder for best drag-and-drop behavior.

---

## Roadmap

| System | Status |
|--------|--------|
| NES | ✅ Done |
| Game Boy / Game Boy Color | ✅ Done |
| Super Nintendo (SNES) | 🚧 In progress |
| Game Boy Advance | 🚧 In progress |
| Sega Master System | 🔜 Planned |
| Sega Game Gear | 🔜 Planned |
| Sega Genesis | 🔜 Planned |

---

## Credits

* NES Emulator: **JSNES** (JavaScript NES emulator)
* GB/GBC Core: GameBoy-Online (by Grant Galitz)
* Original concept & implementation: **segaboy** ([8-Bit Twister](https://github.com/segaboy/8-Bit-Twister))
* "16-Bit Twister" Fork & expansion: **JPLuker**

---

## License

MIT — do what you want, have fun, give credit. And stretch those fingers first. 🖐️💥
