#!/usr/bin/env python3
"""Delete Live Room directories after their 24-hour expiry."""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from dotenv import load_dotenv

load_dotenv(os.path.join(ROOT, ".env"))

from constants import Constants
from services.live_room_store import LiveRoomStore


if __name__ == "__main__":
    removed = LiveRoomStore(Constants.SESSIONS_DIR_NAME, Constants.PANTS_PATH).cleanup_expired()
    print(f"Removed {len(removed)} expired Live Room(s)")

