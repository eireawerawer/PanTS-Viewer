import os
from dotenv import load_dotenv
import numpy as np
from datetime import datetime

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))


class Constants:
    # app variables
    SESSIONS_DIR_NAME = os.environ.get('SESSIONS_DIR_PATH', 'sessions')
    DB_USER = os.environ.get('DB_USER')
    DB_PASS = os.environ.get('DB_PASS')
    DB_HOST = os.environ.get('DB_HOST')
    DB_NAME = os.environ.get('DB_NAME')


    if all([DB_USER, DB_PASS, DB_HOST, DB_NAME]):
        SQLALCHEMY_DATABASE_URI = f'postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}/{DB_NAME}'
    else:
        print("⚠️ Falling back to SQLite")
        SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'

    #SQLALCHEMY_DATABASE_URI = f'postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}/{DB_NAME}'

    SCHEDULED_CHECK_INTERVAL = 5  # minutes  

    # api_blueprint variables
    BASE_PATH = os.environ.get('BASE_PATH', '/')
    PANTS_PATH = os.environ.get('PANTS_PATH')
    MAIN_NIFTI_FORM_NAME = 'MAIN_NIFTI'
    MAIN_NPZ_FILENAME = 'ct.npz'
    MAIN_NIFTI_FILENAME = 'ct.nii.gz'
    COMBINED_LABELS_FILENAME = 'combined_labels.npz'
    COMBINED_LABELS_NIFTI_FILENAME = 'combined_labels.nii.gz'
    SESSION_TIMEDELTA = 3  # in days

    # NiftiProcessor Variables
    EROSION_PIXELS = 2
    CUBE_LEN = (2 * EROSION_PIXELS) + 1
    STRUCTURING_ELEMENT = np.ones([CUBE_LEN, CUBE_LEN, CUBE_LEN], dtype=bool)

    DECIMAL_PRECISION_VOLUME = 2
    DECIMAL_PRECISION_HU = 1
    VOXEL_THRESHOLD = 100

    PREDEFINED_LABELS = {
        0: "background",
        1: "aorta",
        2: "adrenal_gland_left",
        3: "adrenal_gland_right",
        4: "common_bile_duct",
        5: "celiac_aa",
        6: "colon",
        7: "duodenum",
        8: "gall_bladder",
        9: "postcava",
        10: "kidney_left",
        11: "kidney_right",
        12: "liver",
        13: "pancreas",
        14: "pancreatic_duct",
        15: "superior_mesenteric_artery",
        16: "intestine",
        17: "spleen",
        18: "stomach",
        19: "veins",
        20: "renal_vein_left",
        21: "renal_vein_right",
        22: "cbd_stent",
        23: "pancreatic_pdac",
        24: "pancreatic_cyst",
        25: "pancreatic_pnet"
    }


