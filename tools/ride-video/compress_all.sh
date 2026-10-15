#!/bin/bash
# re-encode every master to 960x540, CRF 26 (about half the size, still sharp enough)
cd "$(dirname "$0")/ride_videos" || exit 1
ls *.mp4 | grep -v '^test' | xargs -P 3 -I{} sh -c 'ffmpeg -y -loglevel error -i "{}" -vf scale=960:540 -c:v libx264 -crf 26 -preset medium -c:a aac -b:a 96k -movflags +faststart "small/{}" && echo "done {}"'
echo ALL_COMPRESSED
