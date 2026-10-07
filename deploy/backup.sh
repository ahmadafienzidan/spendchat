#!/bin/sh
set -eu

data=/var/lib/spendchat
sqlite3 "$data/spendchat.db" ".backup '$data/backups/spendchat-$(TZ=Asia/Jakarta date +%F).db'"
# Keep 14 days: -mtime +13 matches files last modified more than 14 days ago.
find "$data/backups" -name 'spendchat-*.db' -mtime +13 -delete
