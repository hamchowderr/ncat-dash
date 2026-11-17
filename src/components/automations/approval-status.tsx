"use client";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** What the run page knows about an approval step. */
export type ApprovalView = {
  asked: string[];
  forYou: boolean;
  mayDecide: boolean;
  decideBy: number | null;
  whenTimeUp: "reject" | "approve";
  decidedBy: string | null;
  decidedAutomatically: boolean;
};

function names(list: string[]): string {
  if (list.length <= 2) return list.join(" or ");
  return `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}`;
}

/** Who is asked to decide, in one sentence. */
export function askedSentence(view: ApprovalView): string {
  if (view.asked.length === 0) return "Anyone on the team can decide.";
  if (view.forYou && view.asked.length === 1) return "You are asked to decide.";
  return `${names(view.asked)} ${view.asked.length === 1 ? "is" : "are"} asked to decide.`;
}

/** What happens if nobody decides, or null when it waits for as long as it takes. */
export function deadlineSentence(view: ApprovalView): string | null {
  if (view.decideBy === null) return null;
  const outcome = view.whenTimeUp === "approve" ? "approved" : "rejected";
  return `If nobody decides by ${when.format(view.decideBy)}, it is ${outcome} by itself.`;
}

/** Why the buttons are off, for someone who is not asked. */
export function notYoursSentence(view: ApprovalView): string {
  return `Only ${view.asked.length > 0 ? names(view.asked) : "the people asked"}, or a team owner or admin, can decide this one.`;
}

/** Who decided, once it is decided. */
export function decidedSentence(view: ApprovalView, approved: boolean): string | null {
  if (view.decidedAutomatically) {
    return `Nobody decided in time, so it was ${approved ? "approved" : "rejected"} by itself.`;
  }
  if (view.decidedBy) return `${approved ? "Approved" : "Rejected"} by ${view.decidedBy}.`;
  return null;
}

/** The lines shown above the Approve and Reject buttons. */
export function ApprovalWaitingNote({ view }: { view: ApprovalView }) {
  const deadline = deadlineSentence(view);
  return (
    <div className="text-muted-foreground flex flex-col gap-0.5 text-sm" data-approval-note>
      <p>{askedSentence(view)}</p>
      {deadline && <p>{deadline}</p>}
      {!view.mayDecide && <p className="text-foreground">{notYoursSentence(view)}</p>}
    </div>
  );
}
