# Taking the sound out

`-vn` drops the picture, and `-f` names the file: `mp3` makes an .mp3, `wav` a .wav. Without `-f` the toolkit would name it .mp4.

## MP3

```json team-step
{
  "title": "Take the sound out as an MP3",
  "description": "Saves a video's sound on its own as an MP3, for a podcast feed or a transcript. The video needs sound.",
  "blanks": [
    {
      "name": "video_url",
      "label": "The video",
      "kind": "file"
    },
    {
      "name": "quality",
      "label": "Quality (higher is a bigger file)",
      "kind": "choice",
      "options": [
        "128k",
        "192k",
        "320k"
      ],
      "default": "192k"
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
            "argument": "0:a"
          },
          {
            "option": "-vn"
          },
          {
            "option": "-c:a",
            "argument": "libmp3lame"
          },
          {
            "option": "-b:a",
            "argument": "{{quality}}"
          },
          {
            "option": "-f",
            "argument": "mp3"
          }
        ]
      }
    ]
  }
}
```

## WAV

Uncompressed, 16-bit, 48 kHz: the usual for editing.

```json team-step
{
  "title": "Take the sound out as a WAV",
  "description": "Saves a video's sound on its own as an uncompressed WAV, for editing in an audio app. The video needs sound.",
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
            "argument": "0:a"
          },
          {
            "option": "-vn"
          },
          {
            "option": "-c:a",
            "argument": "pcm_s16le"
          },
          {
            "option": "-ar",
            "argument": 48000
          },
          {
            "option": "-f",
            "argument": "wav"
          }
        ]
      }
    ]
  }
}
```
