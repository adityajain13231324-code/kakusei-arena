# Sound v2 credits

## Sound effects
Kenney audio packs, licensed CC0 1.0 (public domain), https://kenney.nl
- Impact Sounds - https://kenney.nl/assets/impact-sounds
- Interface Sounds - https://kenney.nl/assets/interface-sounds
- RPG Audio - https://kenney.nl/assets/rpg-audio
- Sci-fi Sounds - https://kenney.nl/assets/sci-fi-sounds

Files were trimmed, layered, pitch/filter processed and re-encoded (`tools/make_sfx.py`). Whooshes and crowd reactions (cheer, gasp, boo) are synthesized from noise and glottal-pulse oscillators in the script; no recordings are used for them.

## Voices
Generated locally with Kokoro-82M (kokoro-onnx), Apache-2.0, https://huggingface.co/hexgrad/Kokoro-82M. Voices are original blends of the stock Kokoro voices; they do not imitate any real actor. Lines are generic, and crossover fighters only say their move names.

## Rebuild
With the project Python venv and `python -I`: `tools/make_sfx.py`, `tools/make_voice.py`, then `tools/build_manifest.py`.
