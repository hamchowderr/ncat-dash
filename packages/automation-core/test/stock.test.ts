import { describe, expect, it } from "vitest";

import { pexelsHits, pexelsSearchUrl, pixabayHits, pixabaySearchUrl, stockQuery } from "../src";

// Shaped like real answers (Pixabay video 45358, checked 2026-11-19).
const PIXABAY = {
  total: 1,
  totalHits: 1,
  hits: [
    {
      id: 45358,
      pageURL: "https://pixabay.com/videos/id-45358/",
      tags: "coffee, beans, coffee shop",
      duration: 17,
      user: "NickyPe",
      videos: {
        large: {
          url: "https://cdn.pixabay.com/video/2020/07/23/45358-443057031_large.mp4",
          width: 1920,
          height: 1080,
          thumbnail: "https://cdn.pixabay.com/video/2020/07/23/45358-443057031_large.jpg",
        },
        medium: {
          url: "https://cdn.pixabay.com/video/2020/07/23/45358-443057031_medium.mp4",
          width: 1280,
          height: 720,
          thumbnail: "https://cdn.pixabay.com/video/2020/07/23/45358-443057031_medium.jpg",
        },
        small: { url: "", width: 0, height: 0, thumbnail: "" },
      },
    },
    { id: 2, videos: {} },
  ],
};

const PEXELS = {
  videos: [
    {
      id: 1448735,
      url: "https://www.pexels.com/video/video-of-forest-1448735/",
      image: "https://images.pexels.com/videos/1448735/free-video-1448735.jpg",
      duration: 32,
      user: { name: "Ruvim Miksanskiy" },
      video_files: [
        {
          link: "https://videos.pexels.com/a.mp4",
          file_type: "video/mp4",
          width: 3840,
          height: 2160,
        },
        {
          link: "https://videos.pexels.com/b.mp4",
          file_type: "video/mp4",
          width: 1920,
          height: 1080,
        },
        { link: "https://videos.pexels.com/c.m3u8", file_type: "hls", width: 1920, height: 1080 },
      ],
    },
  ],
};

describe("stock search", () => {
  it("sends plain short words", () => {
    expect(stockQuery("  Dad's GARAGE!! ")).toBe("dad s garage");
    const url = new URL(pixabaySearchUrl("KEY", "garage", true));
    expect(url.searchParams.get("q")).toBe("garage");
    expect(url.searchParams.get("safesearch")).toBe("true");
    expect(url.searchParams.get("min_width")).toBeNull();
    expect(new URL(pixabaySearchUrl("KEY", "garage", false)).searchParams.get("min_width")).toBe(
      "1280",
    );
    expect(new URL(pexelsSearchUrl("forest", true)).searchParams.get("orientation")).toBe(
      "portrait",
    );
  });

  it("reads Pixabay's answer, picking the rendition nearest 1080", () => {
    expect(pixabayHits(PIXABAY)).toEqual([
      {
        id: "pixabay:45358",
        url: "https://cdn.pixabay.com/video/2020/07/23/45358-443057031_large.mp4",
        thumbnail: "https://cdn.pixabay.com/video/2020/07/23/45358-443057031_large.jpg",
        page: "https://pixabay.com/videos/id-45358/",
        by: "NickyPe",
        title: "coffee, beans, coffee shop",
        duration: 17,
        width: 1920,
        height: 1080,
      },
    ]);
    expect(pixabayHits({ error: "x" })).toEqual([]);
  });

  it("reads Pexels's answer, skipping streams", () => {
    expect(pexelsHits(PEXELS)).toEqual([
      expect.objectContaining({
        id: "pexels:1448735",
        url: "https://videos.pexels.com/b.mp4",
        title: "video of forest",
        by: "Ruvim Miksanskiy",
        duration: 32,
      }),
    ]);
  });
});
