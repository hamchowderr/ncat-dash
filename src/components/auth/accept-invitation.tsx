"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FullPageLoader } from "@/components/full-page-loader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

import { AuthCard } from "./auth-card";

type Invitation = { organizationName: string; inviterEmail: string; email: string; role: string };

/**
 * Where the link in a team invitation lands. Someone signed out is sent to sign in or
 * create an account first and comes straight back here.
 */
export function AcceptInvitation() {
  const router = useRouter();
  const { invitationId } = useParams<{ invitationId: string }>();
  const session = authClient.useSession();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const signedIn = Boolean(session.data?.user);
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void authClient.organization.getInvitation({ query: { id: invitationId } }).then((result) => {
      if (cancelled) return;
      if (result.error || !result.data) {
        setProblem(
          result.error?.message ??
            "This invitation is not for the account you are signed in with, or it has expired.",
        );
      } else setInvitation(result.data as Invitation);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, invitationId]);

  if (session.isPending) return <FullPageLoader />;

  const here = encodeURIComponent(`/accept-invitation/${invitationId}`);
  if (!signedIn) {
    return (
      <AuthCard
        title="You have been invited to a team"
        description="Sign in or create an account with the email address the invitation was sent to."
      >
        <div className="flex flex-col gap-2">
          <Button asChild>
            <Link href={`/sign-up?next=${here}`}>Create an account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/sign-in?next=${here}`}>Sign in</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  async function accept() {
    setPending(true);
    const result = await authClient.organization.acceptInvitation({ invitationId });
    if (result.error) {
      setPending(false);
      setProblem(result.error.message ?? "The invitation could not be accepted.");
      return;
    }
    const organizationId = result.data?.invitation.organizationId;
    if (organizationId) await authClient.organization.setActive({ organizationId });
    router.replace("/");
  }

  if (problem) {
    return (
      <AuthCard title="This invitation cannot be used" description="Ask for a new one.">
        <div className="flex flex-col gap-4">
          <Alert variant="destructive">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
          <Button asChild variant="outline">
            <Link href="/">Go to the dashboard</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }
  if (!invitation) return <FullPageLoader />;

  return (
    <AuthCard
      title={`Join ${invitation.organizationName}`}
      description={`${invitation.inviterEmail} invited you as ${invitation.role === "admin" ? "an admin" : `a ${invitation.role}`}.`}
    >
      <Button className="w-full" onClick={accept} disabled={pending}>
        {pending ? "Joining" : "Accept invitation"}
      </Button>
    </AuthCard>
  );
}
