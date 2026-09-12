#!/usr/bin/env python3
"""
Audio Generator for DFPlayer Mini MicroSD Card
Generates bilingual MP3 prompts for the Smart Ration Dispenser.
Folder '01': English
Folder '02': Tamil (தமிழ்)
"""

import os
import json
import subprocess
import sys

AUDIO_DIR = os.path.dirname(os.path.abspath(__file__))
MANIFEST_FILE = os.path.join(AUDIO_DIR, 'tracks_manifest.json')
SD_ROOT = os.path.join(AUDIO_DIR, 'sd_card_files')

def ensure_dirs():
    os.makedirs(os.path.join(SD_ROOT, '01'), exist_ok=True)
    os.makedirs(os.path.join(SD_ROOT, '02'), exist_ok=True)

def generate():
    ensure_dirs()

    with open(MANIFEST_FILE, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    print("=======================================================")
    print("  Smart Ration Dispenser: Voice Prompts Generator      ")
    print("=======================================================\n")

    has_gtts = False
    try:
        from gtts import gTTS
        has_gtts = True
        print("[INFO] Google Text-to-Speech (gTTS) library detected.")
    except ImportError:
        print("[INFO] gTTS not installed. Will attempt macOS 'say' command or prompt installation.")
        print("To install gTTS: pip install gTTS\n")

    for track in manifest['tracks']:
        num = f"{track['track_id']:03d}.mp3"
        en_out = os.path.join(SD_ROOT, '01', num)
        ta_out = os.path.join(SD_ROOT, '02', num)

        print(f"[{track['track_id']}/12] Generating {num}...")

        if has_gtts:
            from gtts import gTTS
            # Generate English
            tts_en = gTTS(text=track['en_text'], lang='en', slow=False)
            tts_en.save(en_out)

            # Generate Tamil
            tts_ta = gTTS(text=track['ta_text'], lang='ta', slow=False)
            tts_ta.save(ta_out)
        else:
            # Fallback on macOS 'say' command for English
            aiff_en = en_out.replace('.mp3', '.aiff')
            subprocess.run(['say', '-v', 'Samantha', track['en_text'], '-o', aiff_en], check=False)
            # Convert to mp3 if ffmpeg is available
            subprocess.run(['ffmpeg', '-y', '-i', aiff_en, en_out], stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL, check=False)
            if os.path.exists(aiff_en):
                os.remove(aiff_en)

    print(f"\n[DONE] Audio files written to {SD_ROOT}/01/ and {SD_ROOT}/02/.")
    print("Copy the '01' and '02' folders directly to the root of a FAT32-formatted MicroSD card.")

if __name__ == '__main__':
    generate()
