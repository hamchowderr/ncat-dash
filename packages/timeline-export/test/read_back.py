"""Reads a timeline file with OpenTimelineIO, an independent reader, and prints what it
found as JSON so the tests can compare it with the cut list that was written."""
import json
import sys

import opentimelineio as otio

path, adapter = sys.argv[1], sys.argv[2]
result = otio.adapters.read_from_file(path, adapter_name=adapter)
timelines = [result] if isinstance(result, otio.schema.Timeline) else list(result.find_children(descended_from_type=otio.schema.Timeline))


def clips(track):
    found = []
    for clip in track.find_clips():
        placed = clip.range_in_parent()
        reference = clip.media_reference
        found.append(
            {
                "in": round(clip.source_range.start_time.value),
                "frames": round(clip.source_range.duration.value),
                "at": round(placed.start_time.value),
                "rate": clip.source_range.duration.rate,
                "atRate": placed.start_time.rate,
                "file": getattr(reference, "target_url", None),
            }
        )
    return found


print(
    json.dumps(
        [
            {
                "name": timeline.name,
                "video": [clips(track) for track in timeline.video_tracks()],
                "audio": [clips(track) for track in timeline.audio_tracks()],
            }
            for timeline in timelines
        ]
    )
)
