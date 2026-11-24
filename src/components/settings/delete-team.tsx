"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { useActiveTeam } from "@/lib/team-context";

/**
 * Deleting the team, for its owners: at the foot of Settings > Members. Shaped after
 * Better Auth UI's own Delete Organization row, with GitHub's step of typing the team's
 * name, since everything the team made goes with it and can't be brought back.
 */
export function DeleteTeam() {
  const team = useActiveTeam();
  const teams = useQuery(api.teams.mine);
  const role = teams?.find((each) => each.id === team.id)?.role;
  const [open, setOpen] = useState(false);
  if (role !== "owner") return null;
  return (
    <section aria-labelledby="delete-team" className="flex flex-col gap-3 pt-6">
      <h2 id="delete-team" className="text-destructive text-sm font-semibold">
        Danger zone
      </h2>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm/tight font-medium">Delete team</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Deletes {team.name} and everything in it, for everyone on it. This can&apos;t be undone.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          onClick={() => setOpen(true)}
        >
          Delete team
        </Button>
      </div>
      <DeleteTeamDialog open={open} onOpenChange={setOpen} team={team} />
    </section>
  );
}

export function DeleteTeamDialog({
  open,
  onOpenChange,
  team,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: { id: string; name: string };
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const matches = typed.trim() === team.name.trim();

  function change(next: boolean) {
    if (pending) return;
    onOpenChange(next);
    if (!next) {
      setTyped("");
      setProblem(null);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matches) return;
    setPending(true);
    setProblem(null);
    const result = await authClient.organization.delete({ organizationId: team.id });
    setPending(false);
    if (result.error) {
      setProblem(result.error.message ?? "The team could not be deleted. Try again.");
      return;
    }
    onOpenChange(false);
    toast.success(`${team.name} is deleted.`);
    // The dashboard opens another of the person's teams, or setting up a new one.
    router.replace("/");
  }

  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <TriangleAlert />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete {team.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone on the team loses it, and its automations, files, runs, uploads and connected
              apps are deleted, including the files in its storage. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="delete-team-name">
              Type <span className="font-semibold">{team.name}</span> to confirm
            </FieldLabel>
            <Input
              id="delete-team-name"
              value={typed}
              autoComplete="off"
              disabled={pending}
              onChange={(event) => setTyped(event.target.value)}
            />
          </Field>
          {problem && (
            <p role="alert" className="text-destructive text-sm">
              {problem}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={!matches || pending}>
              {pending ? "Deleting" : "Delete team"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
