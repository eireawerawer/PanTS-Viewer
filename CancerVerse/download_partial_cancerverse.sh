#!/bin/bash

set -u

REPO_ID="BodyMaps/CancerVerse"
REPO_TYPE="dataset"
LOCAL_DIR="."

while true; do
    echo "=========================================="
    echo "Starting/retrying download at $(date)"
    echo "Downloading CV_00000001 through CV_00000100"
    echo "=========================================="

    hf download "$REPO_ID" \
        --repo-type "$REPO_TYPE" \
        --local-dir "$LOCAL_DIR" \
        --include "CancerVerse/CV_0000000[1-9]/*" \
        --include "CancerVerse/CV_000000[1-9][0-9]/*" \
        --include "CancerVerse/CV_00000100/*"

    status=$?

    if [ "$status" -eq 0 ]; then
        echo "Download completed successfully at $(date)"
        break
    fi

    echo "Download failed with exit code $status at $(date)"
    echo "Retrying in 30 minutes..."
    sleep 1800
done