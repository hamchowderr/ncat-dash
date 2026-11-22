# Looks

For matching the look of a sample video, use the ready-made saved-look step instead.

## Brightness, contrast and colour

`eq` does all three in one pass. Small changes go a long way: brightness 0.05, contrast 1.1 and colour 1.2 is already a punchier picture.

```json team-step
{
  "title": "Adjust brightness, contrast and colour",
  "description": "Brightens or darkens a video and changes its contrast and how strong its colours are. 0 colour makes it black and white.",
  "blanks": [
    {
      "name": "video_url",
      "label": "The video",
      "kind": "file"
    },
    {
      "name": "brightness",
      "label": "Brightness (0 is unchanged)",
      "kind": "number",
      "default": 0,
      "min": -0.3,
      "max": 0.3
    },
    {
      "name": "contrast",
      "label": "Contrast (1 is unchanged)",
      "kind": "number",
      "default": 1.1,
      "min": 0.5,
      "max": 2
    },
    {
      "name": "saturation",
      "label": "Colour strength (1 is unchanged, 0 is black and white)",
      "kind": "number",
      "default": 1.2,
      "min": 0,
      "max": 3
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
        "filter": "[0:v]eq=brightness={{brightness}}:contrast={{contrast}}:saturation={{saturation}}[v]"
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
            "argument": "0:a?"
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
            "argument": "copy"
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

## Darken the edges

`vignette` takes its strength as an angle in radians; 0.6 is about the usual look.

```json team-step
{
  "title": "Darken the edges",
  "description": "Adds a vignette: the edges and corners of the picture fade darker, which draws the eye to the middle.",
  "blanks": [
    {
      "name": "video_url",
      "label": "The video",
      "kind": "file"
    },
    {
      "name": "strength",
      "label": "How strong (0.2 is light, 1 is heavy)",
      "kind": "number",
      "default": 0.5,
      "min": 0.1,
      "max": 1.2
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
        "filter": "[0:v]vignette=angle={{strength}}[v]"
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
            "argument": "0:a?"
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
            "argument": "copy"
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
