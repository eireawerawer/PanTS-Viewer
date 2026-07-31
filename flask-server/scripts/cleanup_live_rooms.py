#!/usr/bin/env python3
"""Delete Live Room and education-attempt directories after their expiry."""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from dotenv import load_dotenv

load_dotenv(os.path.join(ROOT, ".env"))

from constants import Constants
from services.education_store import EducationStore
from services.live_room_store import LiveRoomStore


if __name__ == "__main__":
    removed_rooms = LiveRoomStore(Constants.SESSIONS_DIR_NAME, Constants.PANTS_PATH).cleanup_expired()
    removed_attempts = EducationStore(Constants.SESSIONS_DIR_NAME, Constants.PANTS_PATH).cleanup_expired()
    print(f"Removed {len(removed_rooms)} expired Live Room(s) and {len(removed_attempts)} education attempt(s)")
