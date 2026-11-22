# Replacing and muting sound

## Replace the sound

The picture is copied; only the new sound is encoded. `-shortest` ends the file with the shorter input, so a long song is cut at the end of the video.

```json team-step
{
  "title": "Replace the sound",
  "description": "Swaps a video's own sound for another sound file, such as a voice-over or a song. The video ends where the shorter of the two ends.",
  "blanks": [
    {
      "name": "video_url",
      "label": "The video",
      "kind": "file"
    },
    {
      "name": "audio_url",
      "label": "The new sound",
      "kind": "file"
    },
    {
      "name": "audio_volume",
      "label": "Loudness of the new sound (1 is unchanged)",
      "kind": "number",
      "default": 1,
      "min": 0,
      "max": 4
    }
  ],
  "primary": "video_url",
  "request": {
    "inputs": [
      {
        "file_url": "{{video_url}}"
      },
      {
        "file_url": "{{audio_url}}"
      }
    ],
    "filters": [
      {
        "filter": "[1:a]volume={{audio_volume}}[a]"
      }
    ],
    "outputs": [
      {
        "options": [
          {
            "option": "-map",
            "argument": "0:v"
          },
          {
            "option": "-map",
            "argument": "[a]"
          },
          {
            "option": "-c:v",
            "argument": "copy"
          },
          {
            "option": "-c:a",
            "argument": "aac"
          },
          {
            "option": "-b:a",
            "argument": "192k"
          },
          {
            "option": "-shortest"
          },
          {
            "option": "-movflags",
            "argument": "+faststart"
          },
          {
            "option": "-f",
            "argument": "mp4"
          }
        ]
      }
    ]
  }
}
```

## Mute

No filter at all: `-an` leaves the sound out and `-c:v copy` keeps the picture.

```json team-step
{
  "title": "Mute a video",
  "description": "Takes all the sound out of a video and keeps the picture exactly as it is.",
  "blanks": [
    {
      "name": "video_url",
      "label": "The video",
      "kind": "file"
    }
  ],
  "primary": "video_url",
  "request": {
    "inputs": [
      {
        "file_url": "{{video_url}}"
      }
    ],
    "outputs": [
      {
        "options": [
          {
            "option": "-map",
            "argument": "0:v"
          },
          {
            "option": "-c:v",
            "argument": "copy"
          },
          {
            "option": "-an"
          },
          {
            "option": "-movflags",
            "argument": "+faststart"
          },
          {
            "option": "-f",
            "argument": "mp4"
          }
        ]
      }
    ]
  }
}
```

## Silence a stretch

`enable='between(t,A,B)'` turns the volume filter on only between the two times. To bleep instead, mix in a tone: `sine=frequency=1000` trimmed to the same times.

```json team-step
{
  "title": "Silence part of a video",
  "description": "Silences a video's sound between two times, such as a word that should not be heard, and keeps the rest. The video needs sound.",
  "blanks": [
    {
      "name": "video_url",
      "label": "The video",
      "kind": "file"
    },
    {
      "name": "start",
      "label": "Silence from (seconds)",
      "kind": "number",
      "min": 0
    },
    {
      "name": "end",
      "label": "Silence until (seconds)",
      "kind": "number",
      "min": 0
    }
  ],
  "primary": "video_url",
  "request": {
    "inputs": [
      {
        "file_url": "{{video_url}}"
      }
    ],
    "filters": [
      {
        "filter": "[0:a]volume=enable='between(t,{{start}},{{end}})':volume=0[a]"
      }
    ],
    "outputs": [
      {
        "options": [
          {
            "option": "-map",
            "argument": "0:v"
          },
          {
            "option": "-map",
            "argument": "[a]"
          },
          {
            "option": "-c:v",
            "argument": "copy"
          },
          {
            "option": "-c:a",
            "argument": "aac"
          },
          {
            "option": "-b:a",
            "argument": "192k"
          },
          {
            "option": "-movflags",
            "argument": "+faststart"
          },
          {
            "option": "-f",
            "argument": "mp4"
          }
        ]
      }
    ]
  }
}
```
