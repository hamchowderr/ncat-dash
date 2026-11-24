import { api } from "@convex/_generated/api";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FilesView } from "@/components/files/files-view";
import { MediaPreview, OutputNamesProvider } from "@/components/jobs/media-preview";
import { actionOf, answerQuery } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { PlatformFits, PlatformTag } from "./platform-tag";

describe("the platform a clip was made for", () => {
  test("a tag names the platform beside its app's logo", () => {
    render(<PlatformTag platform="Instagram Reels" />);
    const tag = screen.getByTitle("Made for Instagram Reels");
    expect(tag).toHaveTextContent("Made for Instagram Reels");
    expect(tag.querySelector("svg")).not.toBeNull();
  });

  test("a clip on the run page shows the platform it was made for", () => {
    const clip = "https://files.example/ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10_output_0.mp4";
    const other = "https://files.example/opening.mp4";
    render(
      <OutputNamesProvider
        names={{ [clip]: "Claude interview TikTok clip 1" }}
        platforms={{ [clip]: "TikTok" }}
      >
        <MediaPreview url={clip} />
        <MediaPreview url={other} />
      </OutputNamesProvider>,
    );
    const [first, second] = screen.getAllByRole("figure");
    expect(first).toHaveTextContent("Claude interview TikTok clip 1");
    expect(within(first).getByTitle("Made for TikTok")).toBeInTheDocument();
    expect(within(second).queryByTitle(/Made for/)).not.toBeInTheDocument();
  });
});

describe("where else a video fits", () => {
  test("lists the platforms by logo, one per app, with the names to read", () => {
    render(<PlatformFits video={{ width: 1080, height: 1920, duration: 45 }} />);
    const fits = screen.getByRole("img");
    expect(fits.getAttribute("aria-label")).toMatch(/^Fits Instagram Stories, Instagram Reels/);
    expect(fits.getAttribute("aria-label")).toContain("TikTok");
    // Instagram, Facebook, TikTok, YouTube shown, the rest counted.
    expect(fits.querySelectorAll("svg")).toHaveLength(4);
    expect(fits).toHaveTextContent(/\+\d/);
  });

  test("kept to the apps the team posts on", () => {
    render(
      <PlatformFits
        video={{ width: 1080, height: 1920, duration: 45 }}
        apps={["tiktok", "youtube"]}
      />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Fits TikTok, YouTube Shorts");
  });

  test("nothing for a video that fits nothing", () => {
    const { container } = render(
      <PlatformFits video={{ width: 1000, height: 300, duration: 45 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Files", () => {
  test("a clip says the platform it was made for; another video says where it fits", async () => {
    answerQuery(api.storage.get, { bucket: "ncat", publicUrl: null, baseUrl: "https://t.example" });
    answerQuery(api.storage.listUploads, []);
    answerQuery(api.files.detailsIn, []);
    answerQuery(api.contentGoals.get, { kinds: [], apps: ["tiktok"] });
    const file = (name: string, platform: string | null) => ({
      key: `Finished/Shorts/${name}`,
      name,
      size: 1000,
      lastModified: 1_700_000_000_000,
      kind: "video" as const,
      uploadId: null,
      details: { width: 1080, height: 1920, duration: 93 },
      platform,
      usedAs: null,
    });
    actionOf(api.files.list).mockResolvedValue({
      bucket: "ncat",
      folders: [],
      files: [
        file("Claude interview Instagram Reels clip 1.mp4", "Instagram Reels"),
        file("Behind the scenes.mp4", null),
      ],
      next: null,
    });
    renderInApp(<FilesView />);
    expect(await screen.findByRole("columnheader", { name: "Platforms" })).toBeInTheDocument();
    const clipRow = (await screen.findByText("Claude interview Instagram Reels clip 1.mp4")).closest(
      "tr",
    )!;
    expect(within(clipRow).getByTitle("Made for Instagram Reels")).toBeInTheDocument();
    const otherRow = screen.getByText("Behind the scenes.mp4").closest("tr")!;
    expect(within(otherRow).getByRole("img", { name: "Fits TikTok" })).toBeInTheDocument();
  });
});
