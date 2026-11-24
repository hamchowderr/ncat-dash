"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { useActiveTeam } from "@/lib/team-context";

import { DeleteTeam } from "./delete-team";
import { SettingsSection } from "./settings-shell";

const roleNames: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

/** "Maya Ortiz" → "MO", for a teammate without a photo. */
function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

/** Who is on the team, and inviting more people by email. */
export function TeamCard({ canEdit }: { canEdit: boolean }) {
  const team = useActiveTeam();
  const email = useQuery(api.email.status);
  const people = useQuery(api.teams.people, { organizationId: team.id });
  const [role, setRole] = useState<"member" | "admin">("member");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const linkFor = (id: string) => `${window.location.origin}/accept-invitation/${id}`;

  async function copyLink(id: string) {
    try {
      await navigator.clipboard.writeText(linkFor(id));
      toast.success("Invitation link copied");
    } catch {
      toast.error("The link could not be copied.");
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const address = String(new FormData(form).get("email") ?? "").trim();
    setProblem(null);
    setPending(true);
    const result = await authClient.organization.inviteMember({
      email: address,
      role,
      organizationId: team.id,
    });
    setPending(false);
    if (result.error) {
      setProblem(result.error.message ?? "The invitation could not be made. Try again.");
      return;
    }
    form.reset();
    toast.success(
      email?.configured
        ? `Invitation sent to ${address}`
        : "Invitation made. Copy its link and send it yourself.",
    );
  }

  async function cancel(id: string) {
    const result = await authClient.organization.cancelInvitation({ invitationId: id });
    if (result.error) toast.error(result.error.message ?? "That could not be cancelled.");
  }

  return (
    <SettingsSection className="gap-6">
      {canEdit && (
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="min-w-48 flex-1">
                <FieldLabel htmlFor="invite-email">Invite by email</FieldLabel>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  autoComplete="off"
                  placeholder="name@example.com"
                  required
                />
              </Field>
              <Field className="w-32">
                <FieldLabel htmlFor="invite-role">Role</FieldLabel>
                <Select value={role} onValueChange={(value) => setRole(value as typeof role)}>
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Button type="submit" disabled={pending}>
                {pending ? "Inviting" : "Invite"}
              </Button>
            </div>
            {email && !email.configured && (
              <FieldDescription>
                Email is not set up yet, so nothing is sent. Make the invitation, then copy its link
                and send it yourself.
              </FieldDescription>
            )}
            {problem && (
              <Alert variant="destructive">
                <AlertDescription>{problem}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </form>
      )}

      {people === undefined ? (
        <Skeleton className="h-16 rounded-lg" />
      ) : (
        <ul aria-label="People on the team" className="flex flex-col gap-1 text-sm">
          {people.members.map((person) => (
            <li key={person.id} className="flex items-center justify-between gap-3 py-2">
              <span className="flex min-w-0 items-center gap-3">
                <Avatar className="size-8">
                  {person.image && <AvatarImage src={person.image} alt="" />}
                  <AvatarFallback>{initials(person.name)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {person.name}
                    {person.title && (
                      <span className="text-muted-foreground font-normal"> · {person.title}</span>
                    )}
                  </span>
                  <span className="text-muted-foreground block truncate">{person.email}</span>
                </span>
              </span>
              <Badge variant="secondary">{roleNames[person.role] ?? person.role}</Badge>
            </li>
          ))}
          {people.invitations.map((invite) => (
            <li key={invite.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{invite.email}</span>
                <span className="text-muted-foreground block">
                  Invited as {(roleNames[invite.role] ?? "Member").toLowerCase()}, not joined yet
                </span>
              </span>
              {canEdit && (
                <span className="flex shrink-0 gap-1">
                  <Button variant="outline" size="sm" onClick={() => copyLink(invite.id)}>
                    Copy link
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => cancel(invite.id)}>
                    Cancel
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <DeleteTeam />
    </SettingsSection>
  );
}
