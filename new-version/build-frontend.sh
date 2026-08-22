#!/bin/sh
# Rebuilds the Flutter web PWA and deploys it into ./public, which the Bun
# backend serves statically (same-origin as the API, so the session cookie
# just works). Run this after any change under frontend/lib or frontend/web.
set -e
cd "$(dirname "$0")/frontend"
flutter build web
cd ..
rm -rf public/*
cp -r frontend/build/web/* public/
echo "Deployed frontend/build/web -> public/"
