import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkKey,
  domainOf,
  invitationEmail,
  isEmailAddress,
  passwordResetEmail,
  emailChangeEmail,
  passwordChangedEmail,
  approvalTimedOutEmail,
  approvalWaitingEmail,
  clientFeedbackEmail,
  digestEmail,
  mentionEmail,
  agentAnswerEmail,
  readyForReviewEmail,
  clipFinishedEmail,
  rightsEndingEmail,
  runFailedEmail,
  sendEmail,
  senderProblem,
  verificationEmail,
  trialEndedEmail,
  trialEndingEmail,
  trialTipEmail,
  thanksEmail,
  welcomeEmail,
  betaInviteEmail,
  betaCheckInEmail,
  withUnsubscribe,
  testEmail,
} from "../src";

const branding = { appName: "Takewon" };

// The official toSend SDK calls the global fetch, so the tests stand in for it there.
function answer(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  vi.stubGlobal("fetch", fake);
  return { fake, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const message = { to: "jane@example.com", subject: "Hi", text: "Hello", html: "<p>Hello</p>" };

describe("toSend client", () => {
  it("sends in the shape toSend asks for", async () => {
    const { calls } = answer(200, { message_id: "abc" });
    const result = await sendEmail(
      "tsend_key",
      { email: "alerts@acme.com", name: "Acme" },
      message,
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
      const result = await sendEmail("k", { email: "a@acme.com" }, message);
      expect(result).toMatchObject({ ok: false, status, reason, detail: text });
    }
  });

  it("does not throw when toSend cannot be reached", async () => {
    const down = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", down);
    expect(await sendEmail("k", { email: "a@acme.com" }, message)).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
    expect(await checkKey("k")).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
  });

  it("treats a gateway page that is not JSON as toSend being unreachable", async () => {
    answer(502, "<html>Bad gateway</html>");
    expect(await sendEmail("k", { email: "a@acme.com" }, message)).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
  });

  it("gives up on a toSend that does not answer in time", async () => {
    vi.stubGlobal(
      "fetch",
      ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        })) as unknown as typeof fetch,
    );
    expect(await sendEmail("k", { email: "a@acme.com" }, message, { timeoutMs: 20 })).toMatchObject(
      { ok: false, status: 0, reason: "unreachable" },
    );
  });

  it("sends to the address it is given instead of toSend's own", async () => {
    const { calls } = answer(200, { message_id: "x" });
    await sendEmail("k", { email: "a@acme.com" }, message, { baseUrl: "https://mail.test" });
    expect(calls[0].url).toBe("https://mail.test/v2/emails");
  });

  it("checks a key and lists its sending domains", async () => {
    const { calls } = answer(200, {
      account: { status: "active" },
      domains: [
        { domain_name: "Acme.com", verification_status: "verified" },
        { domain_name: "new.acme.com", verification_status: "pending" },
      ],
    });
    const result = await checkKey("tsend_key");
    expect(calls[0].url).toBe("https://api.tosend.com/v2/info");
    expect(result).toEqual({
      ok: true,
      domains: [
        { name: "acme.com", verified: true },
        { name: "new.acme.com", verified: false },
      ],
    });
    answer(401, { status_code: 401, message: "Invalid API key" });
    expect(await checkKey("nope")).toMatchObject({
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

  it("names the new address on an address change, and links back on a password change", () => {
    const url = "https://dash.example.com/api/auth/verify-email?token=t";
    const change = emailChangeEmail({ name: "Jane", newEmail: "new@<x>.com", url }, branding);
    expect(change.subject).toBe("Approve your new email address");
    expect(change.text).toContain("new@<x>.com");
    expect(change.html).toContain("new@&lt;x&gt;.com");
    expect(change.text).toContain(url);
    const changed = passwordChangedEmail(
      { url: "https://dash.example.com/forgot-password" },
      branding,
    );
    expect(changed.subject).toBe("Your password was changed");
    expect(changed.text).toContain("https://dash.example.com/forgot-password");
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

  it("tells the person who asked that the agent answered, quoting the answer, escaped", () => {
    const sent = agentAnswerEmail(
      {
        teamName: "Salt House",
        reviewTitle: "Weekly clips",
        answer: "Trim <i>one</i> second at 0:02.",
        reviewUrl: "https://dash.example.com/review/r?clip=c&comment=m",
        settingsUrl: "https://dash.example.com/settings#notifications",
      },
      branding,
    );
    expect(sent.subject).toBe("The agent answered you in Weekly clips");
    expect(sent.text).toContain('In the review "Weekly clips" in Salt House:');
    expect(sent.text).toContain('"Trim <i>one</i> second at 0:02."');
    expect(sent.html).toContain("&lt;i&gt;one&lt;/i&gt;");
    expect(sent.html).toContain("https://dash.example.com/review/r?clip=c&amp;comment=m");
    expect(sent.text).toContain("notification settings");
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

describe("the look", () => {
  it("carries Takewon's mark, motto and maker, and a link to change notifications", () => {
    const failed = runFailedEmail(
      {
        automationName: "Clips",
        message: "No reply.",
        retries: 0,
        runUrl: "https://d/runs/1",
        settingsUrl: "https://d/settings/notifications",
      },
      { appName: "Takewon" },
    );
    expect(failed.html).toContain("Your content, social media ready.");
    expect(failed.html).toContain(
      "Made by Otaku Solutions, 10521 West Zamora Ave, Los Angeles, CA 90002.",
    );
    expect(failed.text).toContain("10521 West Zamora Ave, Los Angeles, CA 90002");
    expect(failed.html).toContain('href="https://d/settings/notifications"');
    expect(failed.html).toContain("Change your notification settings");
    expect(failed.text).toContain("Notification settings: https://d/settings/notifications");
  });

  it("keeps another name's emails plain", () => {
    const own = testEmail({}, { appName: "Acme Clips" });
    expect(own.html).toContain("Sent by Acme Clips.");
    expect(own.html).not.toContain("Otaku Solutions");
    expect(own.html).not.toContain("social media ready");
  });

  it("links each line of a daily summary", () => {
    const digest = digestEmail(
      {
        items: [{ title: "Clips failed", detail: "No reply", url: "https://d/runs/1" }],
        settingsUrl: "https://d/settings/notifications",
      },
      branding,
    );
    expect(digest.html).toContain('<a href="https://d/runs/1"');
    expect(digest.html).toContain(">Clips failed</a>");
  });
});

describe("first days", () => {
  const links = {
    homeUrl: "https://d/",
    uploadsUrl: "https://d/uploads",
    readyMadeUrl: "https://d/automations/new",
    brandUrl: "https://d/settings/brand",
  };

  it("welcomes someone with three first steps and the trial's length", () => {
    const welcome = welcomeEmail(
      { name: "Maya", teamName: "Salt <House>", trialDays: 3, ...links },
      { appName: "Takewon" },
    );
    expect(welcome.subject).toBe("Welcome to Takewon");
    expect(welcome.text).toContain("Your team Salt <House> is ready.");
    expect(welcome.text).toContain("free trial runs for 3 days, and no card is needed");
    expect(welcome.html).toContain("Salt &lt;House&gt;");
    for (const url of Object.values(links)) expect(welcome.text).toContain(url);
    const noTrial = welcomeEmail({ teamName: "Salt House", trialDays: null, ...links }, branding);
    expect(noTrial.text).not.toContain("trial");
  });

  it("tells a beta tester it's a beta instead of a trial", () => {
    const beta = welcomeEmail(
      { teamName: "Salt House", trialDays: 3, beta: true, ...links },
      { appName: "Takewon" },
    );
    expect(beta.text).toContain("You're one of the first people testing Takewon");
    expect(beta.text).not.toContain("trial");
  });

  it("invites a beta tester, naming where they met when it was an event", () => {
    const invite = betaInviteEmail(
      { name: "Ana Lopez", metAt: "The KINN", signUpUrl: "https://app/sign-up" },
      { appName: "Takewon", supportEmail: "support@takewon.com" },
    );
    expect(invite.subject).toBe("You're in the Takewon beta");
    expect(invite.text).toContain("Hi Ana, It was good to meet you at The KINN.");
    expect(invite.text).toContain("https://app/sign-up");
    expect(invite.text).toContain("Chowderr");
    expect(invite.replyTo).toBe("support@takewon.com");
    const plain = betaInviteEmail({ signUpUrl: "https://app/sign-up" }, { appName: "Takewon" });
    expect(plain.text).toContain("Hi, Thanks for signing up");
    expect(plain.text).not.toContain("good to meet you");
  });

  it("checks in once, with questions that fit whether a video went through", () => {
    const used = betaCheckInEmail(
      { name: "Ana", uploaded: true, uploadsUrl: "https://app/library" },
      { appName: "Takewon" },
    );
    expect(used.subject).toBe("How is Takewon going?");
    expect(used.text).toContain("What would make you use it every week?");
    expect(used.text).not.toContain("https://app/library");
    const idle = betaCheckInEmail(
      { name: "Ana", uploaded: false, uploadsUrl: "https://app/library" },
      { appName: "Takewon" },
    );
    expect(idle.subject).toBe("Anything stopping you trying Takewon?");
    expect(idle.text).toContain("What stopped you from trying it?");
    expect(idle.text).toContain("https://app/library");
  });

  it("warns a day before a trial ends, then says it has, pointing at where to buy", () => {
    const ending = trialEndingEmail(
      { teamName: "Salt House", buyUrl: "https://takewon.com/pricing", homeUrl: "https://d/" },
      { appName: "Takewon" },
    );
    expect(ending.subject).toBe("Your Takewon trial ends tomorrow");
    expect(ending.text).toContain("Get Takewon: https://takewon.com/pricing");
    const ended = trialEndedEmail(
      { name: "Maya", teamName: "Salt House", buyUrl: null, homeUrl: "https://d/" },
      { appName: "Takewon" },
    );
    expect(ended.subject).toBe("Your Takewon trial has ended");
    expect(ended.text).toContain("Everything you made is kept");
    expect(ended.text).toContain("Open Takewon: https://d/");
  });
});

describe("unsubscribe", () => {
  it("adds the one-click headers, a footer link and a text line", () => {
    const failed = runFailedEmail(
      {
        automationName: "Clips",
        message: "No reply.",
        retries: 0,
        runUrl: "https://d/runs/1",
        settingsUrl: "https://d/settings/notifications",
      },
      branding,
    );
    const url = "https://api.example/email/unsubscribe?token=a.b";
    const out = withUnsubscribe(failed, url);
    expect(out.headers).toEqual({
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(out.html).toContain(">Unsubscribe</a>");
    expect(out.html).not.toContain("<!--unsubscribe-->");
    expect(out.text).toContain(`Unsubscribe: ${url}`);
  });
});

describe("trial tips", () => {
  const base = {
    teamName: "Salt House",
    uploadsUrl: "https://d/library",
    readyMadeUrl: "https://d/automations/new",
    buyUrl: "https://takewon.com/pricing",
    homeUrl: "https://d/",
    settingsUrl: "https://d/settings/notifications",
  };

  it("each tip gives one next step, says why it came, and where to stop it", () => {
    const first = trialTipEmail({ ...base, tip: "first_upload", name: "Maya" }, branding);
    expect(first.subject).toBe("Your first video is one click away");
    expect(first.text).toContain("Upload a video: https://d/library");
    expect(first.text).toContain("You get these because you started a free trial.");
    expect(first.text).toContain("Notification settings: https://d/settings/notifications");

    const clips = trialTipEmail(
      { ...base, tip: "clips_ready", runUrl: "https://d/runs/7" },
      branding,
    );
    expect(clips.subject).toBe("Your first clips are ready");
    expect(clips.text).toContain("See your clips: https://d/runs/7");

    const every = trialTipEmail({ ...base, tip: "every_upload" }, branding);
    expect(every.text).toContain("Pick a ready-made automation: https://d/automations/new");

    const back = trialTipEmail({ ...base, tip: "come_back" }, branding);
    expect(back.subject).toBe("Still want your content social media ready?");
    expect(back.text).toContain("Your content, social media ready.");
    expect(back.text).toContain("Get Takewon: https://takewon.com/pricing");
  });

  it("the thanks has no buy button and names the team", () => {
    const thanks = thanksEmail(
      { name: "Maya", teamName: "Salt House", homeUrl: "https://d/" },
      branding,
    );
    expect(thanks.subject).toBe("Thanks for getting Takewon");
    expect(thanks.text).toContain("Salt House is all set.");
    expect(thanks.text).toContain("Open Takewon: https://d/");
  });
});

describe("what every good email has", () => {
  const links = {
    homeUrl: "https://d/",
    uploadsUrl: "https://d/uploads",
    readyMadeUrl: "https://d/automations/new",
    brandUrl: "https://d/settings/brand",
  };

  it("sends replies to the support inbox and says so in the footer", () => {
    const email = welcomeEmail(
      { teamName: "Salt House", trialDays: 3, ...links },
      { appName: "Takewon", supportEmail: "support@takewon.com" },
    );
    expect(email.replyTo).toBe("support@takewon.com");
    expect(email.text).toContain("Questions? Reply to this email or write to support@takewon.com.");
    expect(email.html).toContain('href="mailto:support@takewon.com"');
    // It survives the unsubscribe link being added.
    expect(withUnsubscribe(email, "https://d/u").replyTo).toBe("support@takewon.com");
    const without = welcomeEmail({ teamName: "Salt House", trialDays: 3, ...links }, branding);
    expect(without.replyTo).toBeUndefined();
    expect(without.text).not.toContain("Questions?");
  });

  it("signs the welcome from the founder, only in Takewon's own emails", () => {
    const ours = welcomeEmail({ teamName: "Salt House", trialDays: 3, ...links }, branding);
    expect(ours.text).toContain("just reply: it comes to me.");
    expect(ours.text).toContain("Chowderr\nFounder, Takewon");
    expect(ours.html).toContain("Founder, Takewon");
    const theirs = welcomeEmail(
      { teamName: "Salt House", trialDays: 3, ...links },
      { appName: "Studio Desk" },
    );
    expect(theirs.text).not.toContain("Chowderr");
  });

  it("shows moving previews of the person's own clips, each with alt text, linked to the run", () => {
    const email = trialTipEmail(
      {
        tip: "clips_ready",
        teamName: "Salt House",
        uploadsUrl: "https://d/library",
        readyMadeUrl: "https://d/automations/new",
        runUrl: "https://d/runs/r1",
        previews: ["https://f/1.gif", "https://f/2.gif?a=1&b=2", "https://f/3.gif", "https://f/4.gif"],
        buyUrl: null,
        homeUrl: "https://d/",
        settingsUrl: "https://d/settings/notifications",
      },
      branding,
    );
    const images = email.html.match(/<img [^>]*>/g) ?? [];
    expect(images).toHaveLength(3);
    expect(images[0]).toContain('src="https://f/1.gif"');
    expect(images[0]).toContain('alt="Preview of clip 1"');
    expect(images[0]).toContain('width="150"');
    expect(images[1]).toContain('src="https://f/2.gif?a=1&amp;b=2"');
    expect(email.html).toContain('<a href="https://d/runs/r1" style="text-decoration:none;"><img');
    // No previews: no pictures.
    const plain = trialTipEmail(
      {
        tip: "clips_ready",
        teamName: "Salt House",
        uploadsUrl: "https://d/library",
        readyMadeUrl: "https://d/automations/new",
        buyUrl: null,
        homeUrl: "https://d/",
        settingsUrl: "https://d/settings/notifications",
      },
      branding,
    );
    expect(plain.html).not.toContain("<img");
  });

  it("hands the reply-to to toSend", async () => {
    const { calls } = answer(200, { message_id: "m1" });
    await sendEmail(
      "tsend_key",
      { email: "no-reply@takewon.com", name: "Takewon" },
      { to: "maya@example.test", subject: "Hi", text: "Hi", html: "<p>Hi</p>", replyTo: "support@takewon.com" },
    );
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.reply_to).toEqual({ email: "support@takewon.com" });
  });
});
