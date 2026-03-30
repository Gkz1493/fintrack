#!/bin/bash
# FinTrack â GitHub push script
# Run this once from the fintrack-git folder

TOKEN="YOUR_GITHUB_PAT_HERE"
REMOTE="https://Gkz1493:${TOKEN}@github.com/Gkz1493/fintrack.git"

git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"
git branch -M main
git push -u origin main

echo ""
echo "â Pushed to https://github.com/Gkz1493/fintrack"
