#!/bin/bash
# ═══════════════════════════════════════════════
#  AUREN — Premiere Pro Extension Installer (Mac)
#  Just double-click this file in Finder!
# ═══════════════════════════════════════════════

clear
echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   AUREN Extension Installer          ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  Installing..."
echo ""

# Enable unsigned extensions
defaults write com.adobe.CSXS.12 PlayerDebugMode 1 2>/dev/null
defaults write com.adobe.CSXS.11 PlayerDebugMode 1 2>/dev/null
defaults write com.adobe.CSXS.10 PlayerDebugMode 1 2>/dev/null

# Create symlink
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
TARGET="$CEP_DIR/com.auren.premiere.panel"

mkdir -p "$CEP_DIR"
[ -e "$TARGET" ] || [ -L "$TARGET" ] && rm -rf "$TARGET"
ln -s "$SOURCE_DIR" "$TARGET"

echo "  ✅ Done! Now:"
echo ""
echo "  1. Restart Premiere Pro"
echo "  2. Window → Extensions → AUREN Panel"
echo ""
read -p "  Press Enter to close..."
