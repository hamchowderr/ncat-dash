import { describe, expect, it } from "vitest";
import {
  checkKey,
  domainOf,
  invitationEmail,
  isEmailAddress,
  passwordResetEmail,
  approvalTimedOutEmail,
  approvalWaitingEmail,
  clientFeedbackEmail,
  digestEmail,
  mentionEmail,
  readyForReviewEmail,
  clipFinishedEmail,
  rightsEndingEmail,
  runFailedEmail,
  sendEmail,
  senderProblem,
  verificationEmail,
} from "../src";

const branding = { appName: "Takewon" };

function answer(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fake, calls };
}

const message = { to: "jane@example.com", subject: "Hi", text: "Hello", html: "<p>Hello</p>" };

describe("toSend client", () => {
  it("sends in the shape toSend asks for", async () => {
    const { fake, calls } = answer(200, { message_id: "abc" });
    const result = await sendEmail(
      "tsend_key",
      { email: "alerts@acme.com", name: "Acme" },
      message,
      { fetch: fake },
    );
    expect(result).toEqual({ ok: true, messageId: "abc" });
    expect(calls[0].url).toBe("https://api.tosend.com/v2/emails");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tsend_key",
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: { email: "alerts@acme.com", name: "Acme" },
      to: [{ email: "jane@example.com" }],
      subject: "Hi",
      html: "<p>Hello</p>",
      text: "Hello",
    });
  });

  it("says why a send failed", async () => {
    const cases: [number, string, string][] = [
      [401, "Invalid API key", "unauthorized"],
      [402, "Subscription required. Subscribe in Billing to keep sending.", "billing"],
      [403, "Insufficient credit balance", "billing"],
      [422, "Domain acme.com is not verified", "domain"],
      [422, "Validation failed", "refused"],
      [429, "Too many requests", "busy"],
      [500, "Server error", "busy"],
    ];
    for (const [status, text, reason] of cases) {
      const { fake } = answer(status, { status_code: status, message: text });
      const result = await sendEmail("k", { email: "a@acme.com" }, message, { fetch: fake });
      expect(result).toMatchObject({ ok: false, status, reason, detail: text });
    }
  });

  it("does not throw when toSend cannot be reached", async () => {
    const down = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await sendEmail("k", { email: "a@acme.com" }, message, { fetch: down })).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
    expect(await checkKey("k", { fetch: down })).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
  });

  it("checks a key and lists its sending domains", async () => {
    const { fake, calls } = answer(200, {
      account: { status: "active" },
      domains: [
        { domain_name: "Acme.com", verification_status: "verified" },
        { domain_name: "new.acme.com", verification_status: "pending" },
      ],
    });
    const result = await checkKey("tsend_key", { fetch: fake });
    expect(calls[0].url).toBe("https://api.tosend.com/v2/info");
    expect(result).toEqual({
      ok: true,
      domains: [
        { name: "acme.com", verified: true },
        { name: "new.acme.com", verified: false },
      ],
    });
    const bad = answer(401, { status_code: 401, message: "Invalid API key" });
    expect(await checkKey("nope", { fetch: bad.fake })).toMatchObject({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("only allows sending from a verified domain", () => {
    const domains = [
      { name: "acme.com", verified: true },
      { name: "new.acme.com", verified: false },
    ];
    expect(senderProblem("alerts@acme.com", domains)).toBeNull();
    expect(senderProblem("Alerts@ACME.com", domains)).toBeNull();
    expect(senderProblem("alerts@new.acme.com", domains)).toMatch(/not verified/);
    expect(senderProblem("alerts@other.com", domains)).toMatch(/not a sending domain/);
    expect(senderProblem("Acme <alerts@acme.com>", domains)).toMatch(/one email address/);
    expect(domainOf("a@B.com")).toBe("b.com");
    expect(isEmailAddress("a@b")).toBe(false);
  });
});

describe("messages", () => {
  it("carries the link in both versions and escapes what people typed", () => {
    const url = "https://dash.example.com/reset-password?token=a&b=1";
    const reset = passwordResetEmail({ name: "<b>Jane</b>", url }, branding);
    expect(reset.text).toContain(url);
    expect(reset.html).toContain("https://dash.example.com/reset-password?token=a&amp;b=1");
    expect(reset.html).not.toContain("<b>Jane</b>");
    expect(reset.html).toContain("&lt;b&gt;Jane&lt;/b&gt;");
    expect(verificationEmail({ url }, branding).text).toContain(url);
  });

  it("keeps line breaks out of subjects", () => {
    const invite = invitationEmail(
      { teamName: "Acme\nBcc: x@y.com", inviterName: "Sam", role: "admin", url: "https://x.test" },
      branding,
    );
    expect(invite.subject).toBe("Sam invited you to Acme Bcc: x@y.com");
    expect(invite.text).toContain("as an admin");
  });

  it("describes a failed run and how to stop the emails", () => {
    const failed = runFailedEmail(
      {
        teamName: "Acme",
        automationName: "Clips for social",
        stepName: "Caption video",
        message: "The toolkit did not answer.",
        retries: 2,
        runUrl: "https://dash.example.com/automations/a/runs/r",
        settingsUrl: "https://dash.example.com/settings",
      },
      branding,
    );
    expect(failed.subject).toBe("Run failed: Clips for social");
    expect(failed.text).toContain('The step "Caption video" failed in Acme.');
    expect(failed.text).toContain("tried again 2 times");
    expect(failed.text).toContain("https://dash.example.com/automations/a/runs/r");
    expect(failed.text).toContain("https://dash.example.com/settings");
  });

  it("asks a reviewer to decide, with a link to the run", () => {
    const waiting = approvalWaitingEmail(
      {
        teamName: "Acme",
        automationName: "Clips for social",
        stepName: "Check the clips",
        note: "If nobody decides within 24 hours, it is rejected by itself.",
        runUrl: "https://dash.example.com/automations/a/runs/r",
        settingsUrl: "https://dash.example.com/settings",
      },
      branding,
    );
    expect(waiting.subject).toBe("Waiting for your approval: Clips for social");
    expect(waiting.text).toContain('A run reached the step "Check the clips" in Acme');
    expect(waiting.text).toContain("rejected by itself");
    expect(waiting.html).toContain("Review it");
    expect(waiting.html).toContain("https://dash.example.com/automations/a/runs/r");
    expect(waiting.text).toContain("https://dash.example.com/settings");
  });

  it("says an approval decided by itself when time ran out", () => {
    const timedOut = approvalTimedOutEmail(
      {
        automationName: "Clips for social",
        stepName: "Check the clips",
        outcome: "Nobody decided within 1 day, so it was rejected and the run stopped.",
        runUrl: "https://dash.example.com/automations/a/runs/r",
        settingsUrl: "https://dash.example.com/settings#notifications",
      },
      branding,
    );
    expect(timedOut.subject).toBe("An approval ran out of time: Clips for social");
    expect(timedOut.text).toContain("rejected and the run stopped");
    expect(timedOut.text).toContain("https://dash.example.com/settings#notifications");
  });

  it("tells the team what a client said, escaped", () => {
    const feedback = clientFeedbackEmail(
      {
        teamName: "Salt House",
        from: "Riley <Client>",
        reviewTitle: "Weekly clips",
        feedback: "Love it, <i>ship</i> it",
        reviewUrl: "https://dash.example.com/review/r?clip=c&comment=m",
        settingsUrl: "https://dash.example.com/settings#notifications",
      },
      branding,
    );
    expect(feedback.subject).toBe("Riley <Client> left feedback on Weekly clips");
    expect(feedback.text).toContain('"Love it, <i>ship</i> it"');
    expect(feedback.text).toContain("https://dash.example.com/review/r?clip=c&comment=m");
    expect(feedback.html).toContain("&lt;i&gt;ship&lt;/i&gt;");
    expect(feedback.html).not.toContain("<i>ship</i>");
  });

  it("tells the team a project's slot has a new version to review", () => {
    const ready = readyForReviewEmail(
      {
        teamName: "Salt House",
        from: "Dev Patel",
        projectName: "Episode <12>",
        slot: "Short 3",
        reviewUrl: "https://dash.example.com/review/r?clip=c",
        settingsUrl: "https://dash.example.com/settings#notifications",
      },
      branding,
    );
    expect(ready.subject).toBe("Short 3 in Episode <12> is ready for review");
    expect(ready.text).toContain("Dev Patel added a new version");
    expect(ready.text).toContain("https://dash.example.com/review/r?clip=c");
    expect(ready.html).toContain("Episode &lt;12&gt;");
  });

  it("says a run finished, how many files it made, and links to the run", () => {
    const done = clipFinishedEmail(
      {
        teamName: "Salt House",
        automationName: "Shorts <daily>",
        summary: "3 new files are ready in Files.",
        runUrl: "https://dash.example.com/automations/a/runs/r",
        settingsUrl: "https://dash.example.com/settings/notifications",
      },
      branding,
    );
    expect(done.subject).toBe("New files from Shorts <daily>");
    expect(done.text).toContain("3 new files are ready in Files. In Salt House.");
    expect(done.text).toContain("https://dash.example.com/automations/a/runs/r");
    expect(done.html).toContain("Shorts &lt;daily&gt;");
  });

  it("warns that a creator's rights for a client end soon, and links to the creator", () => {
    const ending = rightsEndingEmail(
      {
        teamName: "Salt House",
        creator: "Ana <Ruiz>",
        client: "Acme",
        summary: "The last day you may use their footage is in 7 days, on Saturday, November 28.",
        creatorsUrl: "https://dash.example.com/creators/c1",
        settingsUrl: "https://dash.example.com/settings/notifications",
      },
      branding,
    );
    expect(ending.subject).toBe("Ana <Ruiz>'s rights for Acme end soon");
    expect(ending.text).toContain("in 7 days, on Saturday, November 28. In Salt House.");
    expect(ending.text).toContain("https://dash.example.com/creators/c1");
    expect(ending.html).toContain("Ana &lt;Ruiz&gt;");
  });

  it("tells a person they were mentioned, quoting the comment, escaped", () => {
    const mention = mentionEmail(
      {
        from: "Maya Ortiz",
        reviewTitle: "Weekly clips",
        comment: "@Dev Patel <b>tighten</b> the cut",
        reviewUrl: "https://dash.example.com/review/r?clip=c&comment=m",
        settingsUrl: "https://dash.example.com/settings#notifications",
      },
      branding,
    );
    expect(mention.subject).toBe("Maya Ortiz mentioned you in Weekly clips");
    expect(mention.text).toContain('"@Dev Patel <b>tighten</b> the cut"');
    expect(mention.html).toContain("&lt;b&gt;tighten&lt;/b&gt;");
    expect(mention.html).toContain("Open the review");
  });

  it("gathers a day's news into one summary", () => {
    const digest = digestEmail(
      {
        teamName: "Acme",
        items: [
          { title: "Clips failed", detail: "Captions: no reply", url: "https://d/runs/1" },
          { title: "Maya mentioned you in Weekly clips", url: "https://d/review/2" },
        ],
        settingsUrl: "https://d/settings#notifications",
      },
      branding,
    );
    expect(digest.subject).toBe("Your daily summary: 2 things to know in Acme");
    expect(digest.text).toContain("Clips failed: Captions: no reply (https://d/runs/1)");
    expect(digest.text).toContain("Maya mentioned you in Weekly clips (https://d/review/2)");
  });
});
