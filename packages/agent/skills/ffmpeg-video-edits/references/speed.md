# Speed

## Speed up or slow down

`setpts` changes the picture's timing and `atempo` the sound's, so both stay together and voices keep their pitch. `atempo` takes 0.5 to 100, so this step goes from half speed to four times. The video needs sound; for a silent one, drop the `[0:a]` half and map only `[v]`.

```json team-step
{
  "title": "Change the speed",
  "description": "Plays a video faster or slower, sound and all, without changing the pitch of voices. The video needs sound.",
  "blanks": [
    {
      "name": "video_url",
      "label": "The video",
      "kind": "file"
    },
    {
      "name": "speed",
      "label": "How fast (2 is twice as fast, 0.5 is half speed)",
      "kind": "number",
      "default": 1.5,
      "min": 0.5,
      "max": 4
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
        "filter": "[0:v]setpts=PTS/{{speed}}[v];[0:a]atempo={{speed}}[a]"
      }
    ],
    "outputs": [
      {
        "options": [
          {
            "option": "-map",
            "argument": "[v]"
          },
          {
            "option": "-map",
            "argument": "[a]"
          },
          {
            "option": "-c:v",
            "argument": "libx264"
          },
          {
            "option": "-preset",
            "argument": "veryfast"
          },
          {
            "option": "-crf",
            "argument": 20
          },
          {
            "option": "-pix_fmt",
            "argument": "yuv420p"
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
