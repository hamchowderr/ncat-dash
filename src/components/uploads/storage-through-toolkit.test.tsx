import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FilesView } from "@/components/files/files-view";
import { HomeView } from "@/components/home/home-view";
import { ConnectToolkitForm } from "@/components/onboarding/connect-toolkit-form";
import { actionOf, answerQuery } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { UploadsView } from "./uploads-view";

/** Files go to the toolkit's own storage: the toolkit is the only thing a team connects. */

function connect(baseUrl = "https://toolkit.example", apiKey = "secret") {
  fireEvent.change(screen.getByLabelText("Toolkit address"), { target: { value: baseUrl } });
  fireEvent.change(screen.getByLabelText("API key"), { target: { value: apiKey } });
  fireEvent.click(screen.getByRole("button", { name: "Test and connect" }));
}

describe("connecting a toolkit", () => {
  test("a working fork is all there is to set up", async () => {
    actionOf(api.toolkitConnections.connect).mockResolvedValue({ ok: true, buildNumber: "210" });
    renderInApp(<ConnectToolkitForm organizationId="team_1" />);
    expect(screen.queryByLabelText(/bucket/i)).toBeNull();
    expect(screen.queryByLabelText(/secret access key/i)).toBeNull();
    connect();
    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(screen.getByText(/nothing else to connect/)).toBeTruthy();
    expect(actionOf(api.toolkitConnections.connect)).toHaveBeenCalledWith({
      organizationId: "team_1",
      baseUrl: "https://toolkit.example",
      apiKey: "secret",
    });
  });

  test("Stephen's original toolkit gets the steps to switch to the fork", async () => {
    actionOf(api.toolkitConnections.connect).mockResolvedValue({
      ok: false,
      reason: "not_fork",
      detail: "original",
    });
    renderInApp(<ConnectToolkitForm organizationId="team_1" />);
    connect();
    expect(await screen.findByText("This is the original NCA Toolkit")).toBeTruthy();
    const link = screen.getByRole("link", { name: /hamchowderr\/no-code-architects-toolkit/ });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/hamchowderr/no-code-architects-toolkit",
    );
    expect(screen.getByText(/Keep API_KEY and every S3_ setting/)).toBeTruthy();
    expect(screen.getByText(/Redeploy/)).toBeTruthy();
  });

  test("a toolkit whose bucket is broken says what the toolkit reported", async () => {
    actionOf(api.toolkitConnections.connect).mockResolvedValue({
      ok: false,
      reason: "storage",
      detail:
        "The toolkit's storage is not working: The bucket set on this toolkit does not exist.",
    });
    renderInApp(<ConnectToolkitForm organizationId="team_1" />);
    connect();
    expect(await screen.findByText("Your toolkit's storage is not working")).toBeTruthy();
    expect(screen.getByTestId("storage-detail").textContent).toContain("does not exist");
  });
});

describe("before a toolkit is connected", () => {
  test("Uploads points to the toolkit, with no storage form", () => {
    answerQuery(api.storage.get, null);
    answerQuery(api.storage.listUploads, []);
    renderInApp(<UploadsView />);
    expect(screen.getByText(/go to your toolkit's own storage/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to your toolkit" }).getAttribute("href")).toBe("/");
    expect(screen.queryByLabelText(/bucket/i)).toBeNull();
    expect(screen.queryByText(/Connect your storage/)).toBeNull();
  });

  test("Files points to the toolkit too", () => {
    answerQuery(api.storage.get, null);
    answerQuery(api.storage.listUploads, []);
    renderInApp(<FilesView />);
    expect(screen.getByRole("link", { name: "Go to your toolkit" })).toBeTruthy();
  });
});

describe("once connected", () => {
  test("Uploads names the toolkit's bucket and offers no way to change storage", async () => {
    answerQuery(api.storage.get, {
      bucket: "ncat",
      publicUrl: null,
      baseUrl: "https://toolkit.example",
    });
    answerQuery(api.storage.listUploads, []);
    renderInApp(<UploadsView />);
    await waitFor(() => expect(screen.getByText(/toolkit's storage, bucket ncat/)).toBeTruthy());
    expect(screen.queryByText("Change storage")).toBeNull();
  });

  test("the home page shows where files are kept", () => {
    answerQuery(api.toolkitConnections.list, [
      {
        _id: "c1",
        baseUrl: "https://toolkit.example",
        apiKeyHint: "1234",
        status: "ok",
        buildNumber: "210",
        bucket: "ncat",
        lastCheckedAt: 0,
        lastError: null,
      },
    ]);
    renderInApp(<HomeView />);
    fireEvent.click(screen.getByRole("button", { name: "Toolkit connected" }));
    expect(screen.getByText("Kept in the toolkit's bucket, ncat")).toBeTruthy();
  });
});
